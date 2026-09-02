const form = document.getElementById("report-form");
const result = document.getElementById("result");
const resultBody = document.getElementById("result-body");
const recentList = document.getElementById("recent-list");
const previewBtn = document.getElementById("preview-btn");

document.querySelectorAll(".presets button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("latitude").value = btn.dataset.lat;
    document.getElementById("longitude").value = btn.dataset.lng;
  });
});

function renderAuthorities(authorities, geo, notifications) {
  const locationLine = [
    geo?.locality,
    geo?.county,
    geo?.state,
    geo?.inLongIsland ? "Long Island" : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
          <div class="meta">${new Date(r.created_at).toLocaleString()} · ${r.status}</div>
        </article>`
      )
      .join("");
  } catch {
    recentList.innerHTML = "<p class='meta'>Could not load reports.</p>";
  }
}

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
  renderAuthorities(data.authorities, data.geo, []);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  const res = await fetch("/api/reports", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) {
    resultBody.innerHTML = `<p class="meta">${data.error || "Submit failed"}</p>`;
    result.hidden = false;
    return;
  }
  renderAuthorities(data.authorities, data.location, data.notifications);
  loadRecent();
});

loadRecent();
