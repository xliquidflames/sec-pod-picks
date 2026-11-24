// privacy.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

const help = document.querySelector(".privacy-contact");
if (SITE.discord) {
  help.innerHTML = `To delete your account, your name or your picks, <a href="${SITE.discord}" target="_blank" rel="noopener">message ${SITE.accountHelp || "us"} on Discord</a> and it will be removed.`;
}
