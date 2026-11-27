// privacy.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

// The contact line names whoever answers questions (config.js accountHelp).
const help = document.querySelector(".privacy-contact");
if (help && SITE.contactForm) {
  help.innerHTML = `Questions about your data? <a href="#" onclick="openContactForm(); return false;">Send ${escapeHtml(SITE.accountHelp || "us")} a message</a>.`;
}
