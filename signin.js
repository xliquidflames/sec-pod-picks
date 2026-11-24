// signin.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

const params = new URLSearchParams(location.search);
// Only pages on this site, so a link can't send people elsewhere.
const next = /^[\w-]+\.html(\?[\w=&%-]*)?$/.test(params.get("next") || "") ? params.get("next") : "index.html";
// Where sign-in emails and providers send people back to.
const returnUrl = `${location.origin}${location.pathname}?next=${encodeURIComponent(next)}`;
let knownNames = [];

function show(id) {
  ["signinLoading", "signinChoices", "signinClaim", "signinDone", "signinReset"].forEach(s =>
    document.getElementById(s).style.display = s === id ? "" : "none");
}

async function signInWith(provider) {
  setStatus("var(--text-muted)", "Opening sign-in...");
  const { error } = await supabaseClient.auth.signInWithOAuth({ provider, options: { redirectTo: returnUrl } });
  if (error) setStatus("var(--danger)", error.message);
}

function emailAndPassword() {
  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value;
  if (!email || !password) {
    setStatus("var(--danger)", "Enter your email and a password.");
    return null;
  }
  return { email, password };
}

async function signInWithEmail() {
  const creds = emailAndPassword();
  if (!creds) return;
  setStatus("var(--text-muted)", "Signing in...");
  const { error } = await supabaseClient.auth.signInWithPassword(creds);
  if (error) {
    const msg = /confirm/i.test(error.message) ? "Confirm your email first. The link is in your inbox."
      : /invalid/i.test(error.message) ? "That email and password don't match." : error.message;
    return setStatus("var(--danger)", msg);
  }
  await route();
}

async function createAccount() {
  const creds = emailAndPassword();
  if (!creds) return;
  if (creds.password.length < 8) return setStatus("var(--danger)", "Passwords need at least 8 characters.");
  setStatus("var(--text-muted)", "Creating your account...");
  const { data, error } = await supabaseClient.auth.signUp({ ...creds, options: { emailRedirectTo: returnUrl } });
  if (error) return setStatus("var(--danger)", error.message);
  if (data.session) return route();
  setStatus("var(--success)", `Almost done. Open the link we sent to ${creds.email} to finish signing up.`);
}

async function forgotPassword() {
  const email = document.getElementById("emailInput").value.trim();
  if (!email) return setStatus("var(--danger)", "Type your email above first.");
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: returnUrl });
  if (error) return setStatus("var(--danger)", error.message);
  setStatus("var(--success)", `If ${email} has an account, a reset link is on its way.`);
}

async function saveNewPassword() {
  const password = document.getElementById("newPasswordInput").value;
  if (password.length < 8) return setStatus("var(--danger)", "Passwords need at least 8 characters.");
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) return setStatus("var(--danger)", error.message);
  setStatus("var(--success)", "Password saved.");
  await route();
}

async function claimName() {
  const name = document.getElementById("userNameInput").value.trim();
  if (!name) return setStatus("var(--danger)", "Type a name first.");
  setStatus("var(--text-muted)", "Claiming...");
  const { data, error } = await supabaseClient.rpc("claim_name", { p_name: name });
  if (error) return setStatus("var(--danger)", error.message);
  // Then an optional stop to pick favorite teams, and on to where they were going.
  const welcome = `account.html?welcome=1&next=${encodeURIComponent(next)}`;
  if (data && data !== name) {
    setStatus("var(--success)", `You're ${data}, with your history from before.`);
    setTimeout(() => location.replace(welcome), 1500);
    return;
  }
  location.replace(welcome);
}

// Shows the step this visitor is on, or sends them on once they're set.
async function route() {
  const account = await currentAccount();
  if (!account) {
    show("signinChoices");
    return;
  }
  if (!account.name) {
    show("signinClaim");
    setStatus("", "");
    // Names from past entries that no account has claimed yet.
    const [sec, nfl, hoops, claimed] = await Promise.all([
      loadKnownNames(supabaseClient.from("picks").select("user_name").eq("is_host", false)),
      loadKnownNames(supabaseClient.from("nfl_picks").select("user_name")),
      loadKnownNames(supabaseClient.from("hoops_picks").select("user_name")),
      loadKnownNames(supabaseClient.from("profiles").select("user_name:display_name"))
    ]);
    const taken = new Set(claimed.map(n => n.toLowerCase()));
    knownNames = [...new Set([...sec, ...nfl, ...hoops])].filter(n => !taken.has(n.toLowerCase()));
    return;
  }
  try { localStorage.setItem("secPickEmUserName", account.name); } catch (e) {}
  document.getElementById("doneName").textContent = account.name;
  document.getElementById("continueBtn").href = next;
  show("signinDone");
  if (params.has("next")) location.replace(next);
}

setupNameAutocomplete(() => knownNames, (name, query) => name.toLowerCase().includes(query.toLowerCase()));

let recovering = /type=recovery/.test(location.hash);
supabaseClient.auth.onAuthStateChange(event => {
  if (event === "PASSWORD_RECOVERY") {
    recovering = true;
    show("signinReset");
  }
});

(async () => {
  // Waits for a provider or email link's sign-in to finish first.
  await supabaseClient.auth.getSession();
  if (recovering) show("signinReset");
  else await route();
})();
