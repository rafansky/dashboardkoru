const form = document.getElementById("login-form");
const statusNode = document.getElementById("status");
const passwordInput = document.getElementById("password");
const canvas = document.getElementById("matrix-canvas");
const ctx = canvas.getContext("2d");

const chars = "KORUECLUB01<>[]{}:;|/@#$%&*+=";
const fontSize = 16;
let drops = [];

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const columns = Math.max(1, Math.floor(window.innerWidth / fontSize));
  drops = Array.from({ length: columns }, () => Math.floor(Math.random() * -40));
}

function drawMatrix() {
  ctx.fillStyle = "rgba(5, 6, 7, 0.12)";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.font = `${fontSize}px "Share Tech Mono", monospace`;

  for (let i = 0; i < drops.length; i += 1) {
    const char = chars[Math.floor(Math.random() * chars.length)];
    const x = i * fontSize;
    const y = drops[i] * fontSize;
    ctx.fillStyle = i % 3 === 0 ? "rgba(255, 191, 153, 0.95)" : "rgba(249, 112, 45, 0.88)";
    ctx.fillText(char, x, y);

    if (y > window.innerHeight && Math.random() > 0.975) {
      drops[i] = 0;
    }
    drops[i] += 1;
  }
}

resizeCanvas();
setInterval(drawMatrix, 46);
window.addEventListener("resize", resizeCanvas);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusNode.textContent = "Verificando credenciales...";

  const formData = new FormData();
  formData.set("password", passwordInput.value);

  try {
    const response = await fetch("/api/login", { method: "POST", body: formData });
    if (!response.ok) {
      statusNode.textContent = "Clave incorrecta.";
      passwordInput.focus();
      passwordInput.select();
      return;
    }
    statusNode.textContent = "Acceso concedido.";
    window.location.href = "/";
  } catch (error) {
    statusNode.textContent = "No se pudo conectar con el servidor.";
  }
});
