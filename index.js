const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs-extra");
const http = require("http");

puppeteer.use(StealthPlugin());

const leagues = [
  "GB1",
  "GB2",
  "IT1",
  "IT2",
  "ES1",
  "ES2",
  "L1",
  "L2",
  "FR1",
  "FR2",
  "NL1",
  "NL2",
  "PO1",
  "PO2",
];
const leagueSlugs = {
  GB1: "premier-league",
  GB2: "championship",
  IT1: "serie-a",
  IT2: "serie-b",
  ES1: "laliga",
  ES2: "laliga2",
  L1: "bundesliga",
  L2: "2-bundesliga",
  FR1: "ligue-1",
  FR2: "ligue-2",
  NL1: "eredivisie",
  NL2: "eerste-divisie",
  PO1: "liga-portugal",
  PO2: "liga-portugal-2",
};
const startYear = 2006;
const endYear = 2025;
const outputFile = process.env.OUTPUT_FILE || "/data/clubs.json";
const PORT = process.env.PORT || 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let status = {
  processed: 0,
  lastKey: null,
  lastSaved: 0,
  startedAt: Date.now(),
  outputFile,
};

// Lightweight status server for Railway (/status, /download)
http
  .createServer(async (req, res) => {
    try {
      if (req.url === "/status") {
        const exists = await fs.pathExists(outputFile);
        const size = exists ? (await fs.stat(outputFile)).size : 0;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ...status, fileExists: exists, sizeBytes: size })
        );
        return;
      }
      if (req.url === "/download") {
        const exists = await fs.pathExists(outputFile);
        if (!exists) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        fs.createReadStream(outputFile).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
  })
  .listen(PORT, () => {
    console.log(`Status server listening on :${PORT} (/status, /download)`);
  });

async function phase1() {
  const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
  if (process.env.PROXY_URL)
    launchArgs.push(`--proxy-server=${process.env.PROXY_URL}`);
  const browser = await puppeteer.launch({ headless: "new", args: launchArgs });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const type = req.resourceType();
    if (type === "image" || type === "font" || type === "media") {
      req.abort();
    } else {
      req.continue();
    }
  });

  if (process.env.PROXY_USER && process.env.PROXY_PASS) {
    await page.authenticate({
      username: process.env.PROXY_USER,
      password: process.env.PROXY_PASS,
    });
  }

  let acceptedCookies = false;

  async function acceptCookiesIfPresent() {
    if (acceptedCookies) return;
    try {
      // Common selectors used by Transfermarkt's consent banner
      const selectors = [
        "#onetrust-accept-btn-handler",
        "button#onetrust-accept-btn-handler",
        'button[aria-label="Accept all"]',
      ];
      for (const sel of selectors) {
        const el = await page.$(sel);
        if (el) {
          await el.click().catch(() => {});
          await sleep(500);
          acceptedCookies = true;
          break;
        }
      }
    } catch {}
  }

  let clubs = await fs.readJson(outputFile).catch(() => ({})); // Load existing or empty

  let processedCount = 0; // league-season pages processed
  for (let year = startYear; year <= endYear; year++) {
    for (const code of leagues) {
      const slug = leagueSlugs[code];
      if (!slug) {
        console.error(`No slug for ${code}, skipping.`);
        continue;
      }
      const key = `${year}_${code}`;
      status.lastKey = key;
      if (clubs[key]) {
        console.log(`Skipping ${key} (already done)`);
        continue;
      }

      const url = `https://www.transfermarkt.com/${slug}/startseite/wettbewerb/${code}/saison_id/${year}`;
      console.log(`Scraping ${key}: ${url}`);
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await acceptCookiesIfPresent();

        // Try to wait for league table and club links to render
        try {
          await page.waitForSelector("table.items", { timeout: 10000 });
          await page.waitForSelector(
            'a.vereinprofil_tooltip[href*="/startseite/verein/"]',
            { timeout: 10000 }
          );
        } catch {
          // Soft wait and attempt scroll as fallback
          await sleep(1500);
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight)
          );
          await sleep(1000);
        }

        // Primary extraction
        let clubUrls = await page
          .$$eval('a.vereinprofil_tooltip[href*="/startseite/verein/"]', (as) =>
            Array.from(
              new Set(
                as.map((a) => {
                  const href = a.getAttribute("href") || "";
                  return href.startsWith("http")
                    ? href
                    : `https://www.transfermarkt.com${href}`;
                })
              )
            )
          )
          .catch(() => []);

        // Fallback extraction with alternative selectors
        if (!clubUrls || clubUrls.length === 0) {
          clubUrls = await page
            .$$eval(
              'td.hauptlink a.vereinprofil_tooltip[href*="/startseite/verein/"]',
              (as) =>
                Array.from(
                  new Set(
                    as.map((a) => {
                      const href = a.getAttribute("href") || "";
                      return href.startsWith("http")
                        ? href
                        : `https://www.transfermarkt.com${href}`;
                    })
                  )
                )
            )
            .catch(() => []);
        }

        // Last-chance fallback: scan all anchors for club links
        if (!clubUrls || clubUrls.length === 0) {
          clubUrls = await page
            .evaluate(() => {
              const anchors = Array.from(document.querySelectorAll("a"));
              const hrefs = anchors
                .map((a) => a.getAttribute("href") || "")
                .filter((h) => /\/startseite\/verein\//.test(h));
              const absolute = hrefs.map((h) =>
                h.startsWith("http") ? h : `https://www.transfermarkt.com${h}`
              );
              return Array.from(new Set(absolute));
            })
            .catch(() => []);
        }

        // Final normalization/dedup
        clubUrls = Array.from(
          new Set((clubUrls || []).map((u) => u.replace(/\/$/, "")))
        );

        if (clubUrls.length > 0) {
          clubs[key] = clubUrls;
          await fs.writeJson(outputFile, clubs, { spaces: 2 }); // Save incrementally
          console.log(`Saved ${clubUrls.length} clubs for ${key}`);
          status.lastSaved = Object.keys(clubs).length;
        } else {
          console.warn(
            `No clubs found for ${key} – check if URL is valid or page structure changed.`
          );
        }
      } catch (err) {
        console.error(`Error on ${key}: ${err.message}`);
      }

      await sleep(2000 + Math.random() * 3000); // Random delay 2-5s

      processedCount += 1;
      status.processed = processedCount;
      if (processedCount % 10 === 0) {
        const pauseMs = 60 * 1000; // 1 minute
        console.log(
          `Processed ${processedCount} pages. Cooling down for ${Math.round(
            pauseMs / 1000
          )}s to avoid blocks...`
        );
        await sleep(pauseMs);
      }
    }
  }

  await browser.close();
  console.log("Phase 1 complete.");
}

phase1().catch(console.error);
