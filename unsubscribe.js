// unsubscribe.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

// The link in a reminder email: unsubscribe.html?t=<token>. Asks the
// "daily-reminders" function to turn those emails off.
(async () => {
  const title = document.getElementById("unsubTitle");
  const text = document.getElementById("unsubText");
  const token = new URLSearchParams(location.search).get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    title.textContent = "Link not valid";
    text.innerHTML = `That unsubscribe link isn't complete. Turn reminders off from <a href="account.html">your account page</a> instead.`;
    return;
  }
  try {
    const res = await fetch(`${SITE.supabase.url}/functions/v1/daily-reminders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unsub: token })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `error ${res.status}`);
    title.textContent = "You're unsubscribed";
    text.innerHTML = data.what === "hoops"
      ? `No more hoops reminder emails. Change which sports you get from <a href="account.html">your account page</a> anytime.`
      : `You won't get reminder emails anymore. Turn them back on from <a href="account.html">your account page</a> anytime.`;
  } catch (e) {
    title.textContent = "Couldn't unsubscribe";
    text.innerHTML = `Something went wrong (${escapeHtml(e.message)}). Turn reminders off from <a href="account.html">your account page</a> instead, or try the link again later.`;
  }
})();
