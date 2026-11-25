// load.js: every page loads the site's shared files through this one file,
// so a change to any of them means changing SITE_VERSION below and
// uploading the changed file plus this one. No page needs editing.
//
// A page loads it like this, listing any extra scripts it needs in order:
//   <script src="load.js" data-load="sec.js"></script>
// and gets styles.css, config.js, common.js, then those extras, in that
// order. (This file has no version tag of its own; GitHub Pages lets
// browsers keep it about 10 minutes, so changes reach everyone within that.)

const SITE_VERSION = "105";

(function () {
  const me = document.currentScript;
  const extras = ((me && me.dataset.load) || "").split(/\s+/).filter(Boolean);
  const tag = file => `${file}?v=${SITE_VERSION}`;
  // Written straight into the page while it's still loading, so everything
  // runs in order before the rest of the page, as plain tags would.
  document.write(`<link rel="stylesheet" href="${tag("styles.css")}">`);
  ["config.js", "common.js", ...extras].forEach(file => {
    document.write(`<script src="${tag(file)}"><\/script>`);
  });
})();

// A page's own code, from the bottom of the page:
//   <script>siteScript("index.js");</script>
// Same version number as everything else.
function siteScript(file) {
  document.write(`<script src="${file}?v=${SITE_VERSION}"><\/script>`);
}
