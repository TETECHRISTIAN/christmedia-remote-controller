/**
 * Contrôleur (à ouvrir sur le téléphone Android, dans Chrome, puis
 * "Ajouter à l'écran d'accueil" pour l'utiliser comme une vraie app/PWA).
 */

const connectScreen = document.getElementById("connectScreen");
const sessionScreen = document.getElementById("sessionScreen");
const connectError = document.getElementById("connectError");
const remoteVideo = document.getElementById("remoteVideo");
const videoWrap = document.getElementById("videoWrap");
const cursorDot = document.getElementById("cursorDot");
const connChip = document.getElementById("connChip");
const peerName = document.getElementById("peerName");
const hiddenInput = document.getElementById("hiddenInput");
const fileInput = document.getElementById("fileInput");

let ws, pc, dataChannel;
let deviceId, pin;

const DEFAULT_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

// ------- Connexion -------
document.getElementById("connectBtn").onclick = () => {
  const serverUrl = document.getElementById("serverUrl").value.trim();
  deviceId = document.getElementById("deviceId").value.replace(/\s/g, "").trim();
  pin = document.getElementById("pin").value.trim();
  if (!serverUrl || !deviceId || !pin) {
    connectError.textContent = "Remplis tous les champs.";
    return;
  }
  localStorage.setItem("cmr_server", serverUrl);
  connectError.textContent = "Connexion en cours…";

  ws = new WebSocket(serverUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "controller-connect", deviceId, pin }));
  };
  ws.onerror = () => { connectError.textContent = "Impossible de joindre le serveur."; };
  ws.onmessage = onSignalingMessage;
};

// Pré-remplir l'adresse serveur mémorisée
document.getElementById("serverUrl").value = localStorage.getItem("cmr_server") || "";

async function onSignalingMessage(evt) {
  const msg = JSON.parse(evt.data);

  if (msg.type === "error") {
    connectError.textContent = msg.message;
  }

  if (msg.type === "controller-connected") {
    peerName.textContent = msg.name;
    connectError.textContent = "En attente que l'ordinateur accepte…";
  }

  if (msg.type === "agent-decision") {
    if (msg.accepted) {
      showSession();
    } else {
      connectError.textContent = "Connexion refusée sur l'ordinateur distant.";
    }
  }

  if (msg.type === "signal") {
    await handleSignal(msg.data);
  }
}

async function handleSignal(data) {
  if (data.sdp) {
    if (!pc) createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "signal", data: { sdp: answer } }));
    }
  } else if (data.candidate && pc) {
    try { await pc.addIceCandidate(data.candidate); } catch {}
  }
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE });
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: "signal", data: { candidate: e.candidate } }));
  };
  pc.ontrack = (e) => { remoteVideo.srcObject = e.streams[0]; };
  pc.ondatachannel = (e) => { dataChannel = e.channel; setupDataChannel(); };
  pc.onconnectionstatechange = () => {
    const ok = pc.connectionState === "connected";
    connChip.textContent = ok ? "connecté" : pc.connectionState;
    connChip.className = "chip " + (ok ? "on" : "off");
  };
}

function setupDataChannel() {
  dataChannel.onopen = () => console.log("Data channel ouvert");
  dataChannel.onmessage = (e) => {
    // ex: messages de chat renvoyés par l'agent
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "chat") alert("💬 " + msg.text);
    } catch {}
  };
}

function showSession() {
  connectScreen.style.display = "none";
  sessionScreen.style.display = "flex";
}

function sendCtl(obj) {
  if (dataChannel && dataChannel.readyState === "open") dataChannel.send(JSON.stringify(obj));
}

// ------- Tactile : déplacer/cliquer -------
let lastTap = 0;
let dragging = false;

function videoContentRect() {
  // Calcule la zone réelle affichée de la vidéo (object-fit: contain)
  const rect = videoWrap.getBoundingClientRect();
  const vw = remoteVideo.videoWidth || 16;
  const vh = remoteVideo.videoHeight || 9;
  const containerRatio = rect.width / rect.height;
  const videoRatio = vw / vh;
  let dispW, dispH, offX, offY;
  if (videoRatio > containerRatio) {
    dispW = rect.width; dispH = rect.width / videoRatio;
    offX = 0; offY = (rect.height - dispH) / 2;
  } else {
    dispH = rect.height; dispW = rect.height * videoRatio;
    offY = 0; offX = (rect.width - dispW) / 2;
  }
  return { left: rect.left + offX, top: rect.top + offY, width: dispW, height: dispH };
}

function toRatio(clientX, clientY) {
  const r = videoContentRect();
  const xRatio = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
  const yRatio = Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
  return { xRatio, yRatio };
}

videoWrap.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const { xRatio, yRatio } = toRatio(t.clientX, t.clientY);
    sendCtl({ type: "mouse-move", xRatio, yRatio });
    cursorDot.style.display = "block";
    cursorDot.style.left = t.clientX - videoWrap.getBoundingClientRect().left + "px";
    cursorDot.style.top = t.clientY - videoWrap.getBoundingClientRect().top + "px";
    dragging = true;

    const now = Date.now();
    if (now - lastTap < 280) {
      sendCtl({ type: "mouse-button", button: "left", down: true });
      sendCtl({ type: "mouse-button", button: "left", down: false });
    }
    lastTap = now;
  }
  e.preventDefault();
}, { passive: false });

videoWrap.addEventListener("touchmove", (e) => {
  if (e.touches.length === 1 && dragging) {
    const t = e.touches[0];
    const { xRatio, yRatio } = toRatio(t.clientX, t.clientY);
    sendCtl({ type: "mouse-move", xRatio, yRatio });
    const wrapRect = videoWrap.getBoundingClientRect();
    cursorDot.style.left = t.clientX - wrapRect.left + "px";
    cursorDot.style.top = t.clientY - wrapRect.top + "px";
  } else if (e.touches.length === 2) {
    // deux doigts = molette
    sendCtl({ type: "mouse-wheel", deltaY: e.touches[0].clientY - e.touches[1].clientY > 0 ? 5 : -5 });
  }
  e.preventDefault();
}, { passive: false });

videoWrap.addEventListener("touchend", (e) => {
  dragging = false;
  cursorDot.style.display = "none";
  e.preventDefault();
}, { passive: false });

// Appui long = clic droit
let pressTimer;
videoWrap.addEventListener("touchstart", () => {
  pressTimer = setTimeout(() => {
    sendCtl({ type: "mouse-button", button: "right", down: true });
    sendCtl({ type: "mouse-button", button: "right", down: false });
    if (navigator.vibrate) navigator.vibrate(30);
  }, 550);
});
videoWrap.addEventListener("touchend", () => clearTimeout(pressTimer));
videoWrap.addEventListener("touchmove", () => clearTimeout(pressTimer));

// ------- Clavier -------
document.getElementById("keyboardBtn").onclick = () => {
  hiddenInput.value = "";
  hiddenInput.focus();
};
hiddenInput.addEventListener("input", () => {
  const text = hiddenInput.value;
  if (text) {
    sendCtl({ type: "type-text", text });
    hiddenInput.value = "";
  }
});
hiddenInput.addEventListener("keydown", (e) => {
  if (["Enter", "Backspace", "Tab", "Escape"].includes(e.key)) {
    sendCtl({ type: "key", key: e.key, down: true });
    sendCtl({ type: "key", key: e.key, down: false });
  }
});

document.getElementById("escBtn").onclick = () => {
  sendCtl({ type: "key", key: "Escape", down: true });
  sendCtl({ type: "key", key: "Escape", down: false });
};

document.getElementById("ctrlAltDelBtn").onclick = () => {
  alert("Pour des raisons de sécurité Windows, Ctrl+Alt+Suppr ne peut pas être simulé par un logiciel tiers. Utilise plutôt le verrouillage/déverrouillage à distance, ou envoie Ctrl+Alt+Fin (souvent équivalent en session distante).");
};

// ------- Chat -------
document.getElementById("chatBtn").onclick = () => {
  const text = prompt("Message à envoyer à l'ordinateur distant :");
  if (text) sendCtl({ type: "chat", text });
};

// ------- Transfert de fichiers -------
document.getElementById("fileBtn").onclick = () => fileInput.click();
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const chunkSize = 64 * 1024;
  let offset = 0;
  let first = true;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    const buf = await chunk.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    sendCtl({ type: "file-chunk", name: file.name, base64, append: !first });
    first = false;
    offset += chunkSize;
    await new Promise((r) => setTimeout(r, 15)); // éviter de saturer le data channel
  }
  alert(`Fichier "${file.name}" envoyé (${(file.size / 1024).toFixed(0)} Ko).`);
  fileInput.value = "";
});

// ------- Déconnexion -------
document.getElementById("disconnectBtn").onclick = () => {
  if (pc) pc.close();
  if (ws) ws.close();
  sessionScreen.style.display = "none";
  connectScreen.style.display = "flex";
  connectError.textContent = "";
};

// Enregistrer le service worker (mode PWA installable)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
