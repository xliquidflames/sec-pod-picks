// delete-account.html's own code. Loaded at the end of the page by
// siteScript() in load.js, after the shared files.

let delAccount = null;

function showConfirm() {
  document.getElementById("delFirst").style.display = "none";
  document.getElementById("delConfirm").style.display = "block";
  document.getElementById("delTyped").focus();
}

// The last button only works once the name is typed out (any capitals).
const typedMatches = () =>
  document.getElementById("delTyped").value.trim().toLowerCase() === delAccount.name.toLowerCase();
function checkTyped() {
  document.getElementById("delFinal").disabled = !typedMatches();
}

async function deleteEverything(btn) {
  if (!typedMatches()) return;
  const status = document.getElementById("delStatus");
  btn.disabled = true;
  status.style.color = "var(--text-muted)";
  status.textContent = "Deleting...";
  const { error } = await supabaseClient.rpc("delete_my_account", { p_confirm: document.getElementById("delTyped").value });
  if (error) {
    btn.disabled = false;
    status.style.color = "var(--danger)";
    status.textContent = `Nothing was deleted: ${error.message}`;
    return;
  }
  try {
    ["defaultSport", "secPickEmUserName"].forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch (_) {}
  await supabaseClient.auth.signOut().catch(() => {});
  document.getElementById("delCard").style.display = "none";
  document.getElementById("delSub").textContent = "Done.";
  document.getElementById("delDone").style.display = "block";
}

(async () => {
  delAccount = await requireAccount();
  if (!delAccount) return;
  document.getElementById("delSub").innerHTML = `Signed in as <strong>${escapeHtml(delAccount.name)}</strong>`;
  document.getElementById("delName").textContent = delAccount.name;
  document.getElementById("delCard").style.display = "block";
})();
