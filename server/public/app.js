const form = document.getElementById("report-form");
const result = document.getElementById("result");
const resultBody = document.getElementById("result-body");
const recentList = document.getElementById("recent-list");
const previewBtn = document.getElementById("preview-btn");
const classifyBtn = document.getElementById("classify-btn");
const visionBanner = document.getElementById("vision-banner");
const hazardTypeSelect = document.getElementById("hazardType");
const photoInput = document.getElementById("photo");
const autoDetectInput = document.getElementById("autoDetect");

document.querySelectorAll(".presets button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("latitude").value = btn.dataset.lat;
    document.getElementById("longitude").value = btn.dataset.lng;
  });
});

function renderVision(vision) {
  if (!vision) {
    visionBanner.hidden = true;
    visionBanner.innerHTML = "";
    return;
  }
  const pct = Math.round((vision.confidence || 0) * 100);
  visionBanner.hidden = false;
  visionBanner.innerHTML = `
    <strong>${vision.title || vision.label}</strong>
    <span class="meta">${pct}% · ${vision.source} · ${vision.detail || ""}</span>
    ${
      vision.reportable && vision.hazardType
        ? `<span class="meta">Suggested type: ${vision.hazardType}</span>`
        : `<span class="meta">No reportable hazard detected</span>`
    }
  `;
  if (vision.reportable && vision.hazardType && hazardTypeSelect) {
    hazardTypeSelect.value = vision.hazardType;
  }
}

function renderAuthorities(authorities, geo, notifications, vision) {
  const locationLine = [
    geo?.locality,
    geo?.county,
    geo?.state,
    geo?.inLongIsland ? "Long Island" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const visionHtml = vision
    ? `<p class="meta">Visual Intelligence: <strong>${vision.title || vision.label}</strong> (${Math.round(
        (vision.confidence || 0) * 100
      )}%, ${vision.source})</p>`
    : "";

  const authHtml = (authorities || [])
    .map((a) => {
      const note = (notifications || []).find((n) => n.authorityId === a.id);
      return `
        <article class="authority">
          <h3>${a.name}${a.isPlaceholder ? '<span class="badge">placeholder</span>' : ""}</h3>
          <p class="meta">${a.reason}</p>
          <p class="meta">
            ${a.email ? `Email: ${a.email}` : "No email on file"}
            ${a.phone ? ` · Phone: ${a.phone}` : ""}
          </p>
          ${note ? `<p class="meta">Notify: ${note.detail}</p>` : ""}
        </article>
      `;
    })
    .join("");

  resultBody.innerHTML = `
    ${visionHtml}
    <p class="meta">${locationLine || "Location resolved"}</p>
    ${authHtml || "<p class='meta'>No authorities matched.</p>"}
  `;
  result.hidden = false;
}

async function loadRecent() {
  try {
    const res = await fetch("/api/reports");
    const data = await res.json();
    if (!data.reports?.length) {
      recentList.innerHTML = "<p class='meta'>No reports yet.</p>";
      return;
    }
    recentList.innerHTML = data.reports
      .map(
        (r) => `
        <article class="report-row">
          <strong>${r.hazard_type}</strong>
          <div class="meta">${r.locality || "Unknown locality"} · ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</div>
          <div class="meta">${
            r.vision_label
              ? `VI: ${r.vision_label} (${Math.round((r.vision_confidence || 0) * 100)}%) · `
              : ""
          }${new Date(r.created_at).toLocaleString()} · ${r.status}</div>
        </article>`
      )
      .join("");
  } catch {
    recentList.innerHTML = "<p class='meta'>Could not load reports.</p>";
  }
}

classifyBtn.addEventListener("click", async () => {
  const fd = new FormData();
  const photo = photoInput.files?.[0];
  const description = document.getElementById("description").value;
  if (photo) fd.append("photo", photo);
  if (description) fd.append("description", description);
  if (!photo && !description) {
    visionBanner.hidden = false;
    visionBanner.innerHTML = `<span class="meta">Add a photo or description first.</span>`;
    return;
  }
  classifyBtn.disabled = true;
  classifyBtn.textContent = "Identifying…";
  try {
    const res = await fetch("/api/vision/classify", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) {
      visionBanner.hidden = false;
      visionBanner.innerHTML = `<span class="meta">${data.error || "Classify failed"}</span>`;
      return;
    }
    renderVision(data.vision);
  } finally {
    classifyBtn.disabled = false;
    classifyBtn.textContent = "Identify with Visual Intelligence";
  }
});

photoInput.addEventListener("change", () => {
  if (photoInput.files?.[0] && autoDetectInput.checked) {
    classifyBtn.click();
  }
});

previewBtn.addEventListener("click", async () => {
  const hazardType = document.getElementById("hazardType").value;
  const latitude = document.getElementById("latitude").value;
  const longitude = document.getElementById("longitude").value;
  const res = await fetch(
    `/api/routing/preview?hazardType=${encodeURIComponent(hazardType)}&latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
  );
  const data = await res.json();
  if (!res.ok) {
    resultBody.innerHTML = `<p class="meta">${data.error || "Preview failed"}</p>`;
    result.hidden = false;
    return;
  }
  renderAuthorities(data.authorities, data.geo, [], null);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  fd.set("autoDetect", autoDetectInput.checked ? "true" : "false");
  const res = await fetch("/api/reports", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) {
    resultBody.innerHTML = `<p class="meta">${data.error || "Submit failed"}</p>`;
    result.hidden = false;
    return;
  }
  renderVision(data.vision);
  renderAuthorities(data.authorities, data.location, data.notifications, data.vision);
  loadRecent();
});

loadRecent();
