const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs-extra");
const path = require("path");
const http = require("http");

puppeteer.use(StealthPlugin());

// Configuration
const OUTPUT_FILE = process.env.OUTPUT_FILE || "players.json";
const ERROR_LOG_FILE = process.env.ERROR_LOG_FILE || "errors.json";
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 3; // Reduced - we log errors instead of blocking
const ERROR_COOLDOWN = 30 * 1000; // 30 seconds instead of 5 minutes
const PAGE_LOAD_TIMEOUT = 60000; // 60 seconds

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Error logging helper
async function logError(type, url, error, context = {}) {
  try {
    const errors = await fs
      .readJson(ERROR_LOG_FILE)
      .catch(() => ({ failures: [] }));
    if (!errors.failures) errors.failures = [];

    errors.failures.push({
      type,
      url,
      error: error.message,
      context,
      timestamp: new Date().toISOString(),
    });

    await fs.writeJson(ERROR_LOG_FILE, errors, { spaces: 2 });
  } catch {}
}

// Get file size in MB
function getFileSizeMB(filePath) {
  try {
    const stats = require("fs").statSync(filePath);
    return (stats.size / (1024 * 1024)).toFixed(2);
  } catch (error) {
    return 0;
  }
}

// Update file size in status
function updateFileSize() {
  status.fileSize = getFileSizeMB(OUTPUT_FILE);
}

// Status tracking
let status = {
  processed: 0,
  errors: 0,
  lastKey: null,
  lastPlayer: null,
  startedAt: Date.now(),
  outputFile: OUTPUT_FILE,
  fileSize: 0,
};

// Status server
http
  .createServer(async (req, res) => {
    try {
      if (req.url === "/status") {
        const exists = await fs.pathExists(OUTPUT_FILE);
        const size = exists ? (await fs.stat(OUTPUT_FILE)).size : 0;
        updateFileSize(); // Update file size in status
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...status,
            fileExists: exists,
            sizeBytes: size,
            sizeMB: status.fileSize,
            uptime: Date.now() - status.startedAt,
          })
        );
        return;
      }
      if (req.url === "/download") {
        const exists = await fs.pathExists(OUTPUT_FILE);
        if (!exists) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        fs.createReadStream(OUTPUT_FILE).pipe(res);
        return;
      }
      if (req.url === "/errors") {
        const exists = await fs.pathExists(ERROR_LOG_FILE);
        if (!exists) {
          res.writeHead(404);
          res.end("No errors logged");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        fs.createReadStream(ERROR_LOG_FILE).pipe(res);
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
    console.log(`Status server listening on :${PORT}`);
    console.log(`  /status - View progress`);
    console.log(`  /download - Download players.json`);
    console.log(`  /errors - Download errors.json\n`);
  });

// Country code mapping
const countryMap = {
  France: "FRA",
  Germany: "GER",
  Spain: "ESP",
  England: "ENG",
  Italy: "ITA",
  Portugal: "POR",
  Brazil: "BRA",
  Argentina: "ARG",
  Netherlands: "NED",
  Belgium: "BEL",
  Croatia: "CRO",
  Nigeria: "NGA",
  Senegal: "SEN",
  "Côte d'Ivoire": "CIV",
  Uruguay: "URU",
  Colombia: "COL",
  Chile: "CHI",
  Mexico: "MEX",
  Poland: "POL",
  Sweden: "SWE",
  Denmark: "DEN",
  Norway: "NOR",
  Finland: "FIN",
  Scotland: "SCO",
  Wales: "WAL",
  "Republic of Ireland": "IRL",
  "Northern Ireland": "NIR",
  Serbia: "SRB",
  Turkey: "TUR",
  Greece: "GRE",
  Ukraine: "UKR",
  Russia: "RUS",
  Japan: "JPN",
  "South Korea": "KOR",
  Australia: "AUS",
  USA: "USA",
  Canada: "CAN",
  Switzerland: "SUI",
  Austria: "AUT",
  "Czech Republic": "CZE",
  Slovakia: "SVK",
  Hungary: "HUN",
  Romania: "ROU",
  Bulgaria: "BUL",
  Morocco: "MAR",
  Algeria: "ALG",
  Tunisia: "TUN",
  Egypt: "EGY",
  "South Africa": "RSA",
  Ghana: "GHA",
  Cameroon: "CMR",
  Mali: "MLI",
  "Burkina Faso": "BFA",
  Guinea: "GUI",
  Iceland: "ISL",
  Albania: "ALB",
  Slovenia: "SVN",
  "North Macedonia": "MKD",
  "Bosnia-Herzegovina": "BIH",
  Montenegro: "MNE",
  Ecuador: "ECU",
  Paraguay: "PAR",
  Peru: "PER",
  Venezuela: "VEN",
  "Costa Rica": "CRC",
};

function mapPosition(posText) {
  if (!posText) return "Unknown";
  const pos = posText.toLowerCase();
  if (pos.includes("goalkeeper") || pos.includes("keeper")) return "GK";
  if (
    pos.includes("defender") ||
    pos.includes("back") ||
    pos.includes("defence")
  )
    return "DF";
  if (pos.includes("midfield")) return "MF";
  if (
    pos.includes("forward") ||
    pos.includes("winger") ||
    pos.includes("striker") ||
    pos.includes("attack")
  )
    return "ST";
  return "Unknown";
}

function parseDOB(dobText) {
  if (!dobText) return "";
  const slash = dobText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const d = slash[1].padStart(2, "0");
    const m = slash[2].padStart(2, "0");
    const y = slash[3].slice(-2);
    return `${d}-${m}-${y}`;
  }
  const named = dobText.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
  if (named) {
    const monthMap = {
      Jan: "01",
      Feb: "02",
      Mar: "03",
      Apr: "04",
      May: "05",
      Jun: "06",
      Jul: "07",
      Aug: "08",
      Sep: "09",
      Oct: "10",
      Nov: "11",
      Dec: "12",
    };
    const month = monthMap[named[1]] || "01";
    const day = named[2].padStart(2, "0");
    const year = named[3].slice(-2);
    return `${day}-${month}-${year}`;
  }
  return "";
}

function parseTransferDate(dateText) {
  if (!dateText) return null;
  const slashMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);
    return new Date(year, month, day);
  }
  const namedMatch = dateText.match(/(\w+)\s+(\d+),\s+(\d{4})/);
  if (namedMatch) {
    const monthMap = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
    const month = monthMap[namedMatch[1]];
    const day = parseInt(namedMatch[2], 10);
    const year = parseInt(namedMatch[3], 10);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }
  return null;
}

function getSeasonFromDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month >= 6) {
    return `${(year % 100).toString().padStart(2, "0")}/${((year + 1) % 100)
      .toString()
      .padStart(2, "0")}`;
  } else {
    return `${((year - 1) % 100).toString().padStart(2, "0")}/${(year % 100)
      .toString()
      .padStart(2, "0")}`;
  }
}

function isYouthTeam(clubName) {
  if (!clubName) return true;
  const lower = clubName.toLowerCase();
  return (
    lower.includes(" u18") ||
    lower.includes(" u17") ||
    lower.includes(" u19") ||
    lower.includes(" u21") ||
    lower.includes(" u23") ||
    lower.includes("u16") ||
    lower.includes(" b ") ||
    lower.includes(" ii") ||
    lower.includes(" youth") ||
    lower.includes("reserves") ||
    lower.endsWith(" b") ||
    lower.includes("atlètic") ||
    lower.includes("atletico b") ||
    lower === "own youth" ||
    lower === "retired" ||
    lower === "without club"
  );
}

async function retryOperation(
  operation,
  maxRetries = MAX_RETRIES,
  errorContext = ""
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      console.error(
        `  ⚠️  Attempt ${attempt}/${maxRetries} failed for ${errorContext}: ${err.message}`
      );
      if (attempt === maxRetries) {
        console.error(`  ❌ Max retries exceeded for ${errorContext}`);
        throw err;
      }
      const backoff = Math.min(5000 * attempt, 15000); // Shorter backoff
      console.log(`  ⏳ Backing off for ${backoff / 1000}s before retry...`);
      await sleep(backoff);
    }
  }
}

async function scrapePlayerProfile(page, playerUrl, processedUrls) {
  if (processedUrls.has(playerUrl)) {
    console.log(`  ↻ Skipping ${playerUrl} (already processed)`);
    return null;
  }

  console.log(`  📋 Scraping: ${playerUrl}`);

  try {
    const result = await retryOperation(
      async () => {
        const transfersUrl = playerUrl.replace("/profil/", "/transfers/");

        await page.goto(transfersUrl, {
          waitUntil: "networkidle2",
          timeout: PAGE_LOAD_TIMEOUT,
        });
        await sleep(3000);

        // Wait for web component
        try {
          await page.waitForSelector("tm-player-transfer-history", {
            timeout: 15000,
          });
          await sleep(2000);
        } catch {
          console.log(`    ⏳ Extra wait for component...`);
          await sleep(3000);
        }

        // Extract header info
        const playerData = await page.evaluate(() => {
          const name =
            document
              .querySelector("h1.data-header__headline-wrapper")
              ?.innerText.trim() || "";
          const dobSpan = document.querySelector('span[itemprop="birthDate"]');
          const dobText = dobSpan ? dobSpan.textContent.trim() : "";

          let position = "";
          const labels = Array.from(
            document.querySelectorAll("li.data-header__label")
          );
          for (const label of labels) {
            if (label.textContent.includes("Position:")) {
              const posSpan = label.querySelector(".data-header__content");
              if (posSpan) {
                position = posSpan.textContent.trim();
                break;
              }
            }
          }

          const nationalityImgs = document.querySelectorAll(
            'span[itemprop="nationality"] img'
          );
          const nationalities = Array.from(nationalityImgs)
            .map((img) => img.alt)
            .filter(Boolean);
          const nationality = nationalities[0] || "";
          return { name, dobText, position, nationality };
        });

        if (!playerData.name) {
          throw new Error("No name found - page may not be loaded");
        }

        // Extract transfers
        const transfers = await page.evaluate(() => {
          const rows = Array.from(
            document.querySelectorAll(
              "div.grid.tm-player-transfer-history-grid"
            )
          );
          return rows
            .map((row) => {
              const cells = row.querySelectorAll(".grid__cell");
              if (cells.length < 6) return null;

              const season = cells[0]?.innerText.trim() || "";
              const date = cells[1]?.innerText.trim() || "";

              const fromClubLink = cells[2]?.querySelector(
                "a.tm-player-transfer-history-grid__club-link"
              );
              const fromClub = fromClubLink
                ? fromClubLink.getAttribute("title")?.trim() ||
                  fromClubLink.textContent.trim()
                : cells[2]?.textContent.trim() || "";

              const toClubLink = cells[3]?.querySelector(
                "a.tm-player-transfer-history-grid__club-link"
              );
              const toClub = toClubLink
                ? toClubLink.getAttribute("title")?.trim() ||
                  toClubLink.textContent.trim()
                : cells[3]
                    ?.querySelector(
                      "span.tm-player-transfer-history-grid__club-link"
                    )
                    ?.textContent.trim() ||
                  cells[3]?.textContent.trim() ||
                  "";

              const fee = cells[5]?.innerText.trim() || "";

              return { season, date, fromClub, toClub, fee };
            })
            .filter((t) => t && t.date);
        });

        return { playerData, transfers };
      },
      MAX_RETRIES,
      playerUrl
    );

    const { playerData, transfers } = result;

    // Filter professional transfers
    // Keep any transfer where they JOINED a senior professional club
    // (even if coming from youth/B team - we track career, not just transfers)
    const professionalTransfers = transfers.filter(
      (t) => t.toClub && !isYouthTeam(t.toClub)
    );

    professionalTransfers.sort((a, b) => {
      const dateA = parseTransferDate(a.date);
      const dateB = parseTransferDate(b.date);
      if (!dateA || !dateB) return 0;
      return dateA - dateB;
    });

    if (professionalTransfers.length === 0) {
      console.log(`    ⚠️  No professional transfers, skipping`);
      return null;
    }

    // Parse player info
    const nameParts = playerData.name.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || nameParts[0];
    const dob = parseDOB(playerData.dobText);
    const countryCode =
      countryMap[playerData.nationality] ||
      playerData.nationality.slice(0, 3).toUpperCase();
    const customId = `${lastName
      .toLowerCase()
      .replace(/\s+/g, "_")}_${dob}_${countryCode}`;

    // Build seasons - only when they joined a club
    const seasons = {};

    for (const transfer of professionalTransfers) {
      const transferDate = parseTransferDate(transfer.date);
      if (!transferDate) continue;

      const season = getSeasonFromDate(transferDate);
      const toClub = transfer.toClub;
      const isLoan =
        transfer.fee.toLowerCase().includes("loan") &&
        !transfer.fee.toLowerCase().includes("end of loan");
      const isEndOfLoan = transfer.fee.toLowerCase().includes("end of loan");

      if (isEndOfLoan) continue;

      if (!seasons[season]) seasons[season] = new Set();

      if (toClub && !isYouthTeam(toClub)) {
        seasons[season].add(toClub);
      }

      if (isLoan) {
        const fromClub = transfer.fromClub;
        if (fromClub && !isYouthTeam(fromClub)) {
          seasons[season].add(fromClub);
        }
      }
    }

    const finalSeasons = {};
    Object.keys(seasons).forEach((season) => {
      const clubs = Array.from(seasons[season]).filter(
        (c) => c && !isYouthTeam(c)
      );
      if (clubs.length > 0) {
        finalSeasons[season] = clubs;
      }
    });

    processedUrls.add(playerUrl);
    console.log(
      `    ✓ ${playerData.name} (${customId}) - ${
        Object.keys(finalSeasons).length
      } seasons`
    );

    return {
      customId,
      first_name: firstName,
      last_name: lastName,
      position: mapPosition(playerData.position),
      country_code: countryCode,
      dob,
      seasons: finalSeasons,
    };
  } catch (err) {
    console.error(`    ❌ Failed to scrape ${playerUrl}: ${err.message}`);
    status.errors++;
    await logError("player", playerUrl, err, { customId: "unknown" });
    return null; // Continue instead of throwing
  }
}

async function scrapeSquad(page, squadUrl, processedUrls, output) {
  console.log(`\n🏟️  Squad: ${squadUrl}`);

  try {
    await retryOperation(
      async () => {
        await page.goto(squadUrl, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_LOAD_TIMEOUT,
        });
        await sleep(2000);

        try {
          const cookieBtn = await page.$("#onetrust-accept-btn-handler");
          if (cookieBtn) {
            await cookieBtn.click().catch(() => {});
            await sleep(500);
          }
        } catch {}

        try {
          await page.waitForSelector("table.items", { timeout: 15000 });
        } catch {}
        try {
          await page.waitForSelector(
            'a.spielprofil_tooltip[href*="/profil/spieler/"]',
            { timeout: 10000 }
          );
        } catch {}
      },
      MAX_RETRIES,
      squadUrl
    );

    // Extract player URLs
    let playerUrls = await page
      .$$eval('a.spielprofil_tooltip[href*="/profil/spieler/"]', (as) =>
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

    if (!playerUrls || playerUrls.length === 0) {
      playerUrls = await page
        .evaluate(() => {
          const rows = Array.from(
            document.querySelectorAll("table.items tbody tr")
          );
          const urls = rows
            .map((row) => {
              const a = row.querySelector(
                '.hauptlink a[href*="/profil/spieler/"]'
              );
              if (!a) return null;
              const href = a.getAttribute("href");
              return href ? `https://www.transfermarkt.com${href}` : null;
            })
            .filter(Boolean);
          return Array.from(new Set(urls));
        })
        .catch(() => []);
    }

    console.log(`  Found ${playerUrls.length} players`);

    // Batch writes to reduce I/O
    let pendingWrites = 0;

    for (let i = 0; i < playerUrls.length; i++) {
      const playerUrl = playerUrls[i];
      console.log(`  [${i + 1}/${playerUrls.length}]`);

      try {
        const playerData = await scrapePlayerProfile(
          page,
          playerUrl,
          processedUrls
        );

        if (playerData) {
          output.players[playerData.customId] = {
            first_name: playerData.first_name,
            last_name: playerData.last_name,
            position: playerData.position,
            country_code: playerData.country_code,
            dob: playerData.dob,
            seasons: playerData.seasons,
          };
          pendingWrites++;
          if (pendingWrites >= 5) {
            await fs.writeJson(OUTPUT_FILE, output, { spaces: 2 });
            pendingWrites = 0;
          }
          status.processed++;
          status.lastPlayer = playerData.customId;
          updateFileSize(); // Update file size after each player
        }

        await sleep(700 + Math.random() * 1000);

        if ((i + 1) % 15 === 0) {
          console.log(`  💤 Processed 15 players, cooling down for 5s...`);
          updateFileSize();
          if (status.fileSize > 50) {
            console.log(
              `  ⚠️  File size: ${status.fileSize}MB - Consider splitting soon!`
            );
          }
          await sleep(5000);
        }
      } catch (err) {
        console.error(`  ❌ Error on player ${i + 1}: ${err.message}`);
        await logError("player_process", playerUrl, err, {
          squadUrl,
          index: i + 1,
        });
        console.log(
          `  ⏭️  Logged error, continuing after ${ERROR_COOLDOWN / 1000}s...`
        );
        await sleep(ERROR_COOLDOWN);
      }
    }
    // Final flush for any pending writes
    if (pendingWrites > 0) {
      await fs.writeJson(OUTPUT_FILE, output, { spaces: 2 });
      pendingWrites = 0;
    }
  } catch (err) {
    console.error(`❌ Squad error: ${err.message}`);
    await logError("squad", squadUrl, err);
    // Continue instead of throwing
  }
}

async function main() {
  console.log("\n🚀 Starting comprehensive player scraper...\n");

  const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
  if (process.env.PROXY_URL)
    launchArgs.push(`--proxy-server=${process.env.PROXY_URL}`);

  const browser = await puppeteer.launch({ headless: "new", args: launchArgs });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  );
  await page.setViewport({ width: 1366, height: 900 });
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

  await fs.ensureDir(path.dirname(OUTPUT_FILE)).catch(() => {});
  let output = await fs.readJson(OUTPUT_FILE).catch(() => ({ players: {} }));
  if (!output.players) output = { players: {} };

  const processedUrls = new Set(
    Object.values(output.players).map((p) => p.profile_url || "")
  );

  // Load clubs.json
  const CLUBS_FILE = "clubs.json";
  console.log(`📂 Loading clubs from: ${CLUBS_FILE}\n`);
  const clubs = await fs.readJson(CLUBS_FILE);

  // Process each season from clubs.json
  for (const [seasonKey, clubUrls] of Object.entries(clubs)) {
    status.lastKey = seasonKey;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📅 Season: ${seasonKey}`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Clubs to process: ${clubUrls.length}\n`);

    for (let c = 0; c < clubUrls.length; c++) {
      const clubUrl = clubUrls[c];
      const seasonYear = seasonKey.split("_")[0];

      let squadUrl = clubUrl.replace("/startseite/", "/kader/");
      if (!/\/saison_id\//.test(squadUrl))
        squadUrl += `/saison_id/${seasonYear}`;
      if (!/\/plus\/1$/.test(squadUrl)) squadUrl += "/plus/1";

      await scrapeSquad(page, squadUrl, processedUrls, output);
      await sleep(10000);
    }

    console.log(`\n⏸️  Season ${seasonKey} complete. Cooling down for 60s...`);
    await sleep(60000);
  }

  await browser.close();

  console.log("\n✅ Scraping complete!");
  updateFileSize();
  console.log(`   Total unique players: ${Object.keys(output.players).length}`);
  console.log(`   Total processed: ${status.processed}`);
  console.log(`   Total errors: ${status.errors}`);
  console.log(`   File size: ${status.fileSize}MB`);
  console.log(`   Output: ${OUTPUT_FILE}`);

  if (status.errors > 0) {
    console.log(`\n⚠️  ${status.errors} errors logged to: ${ERROR_LOG_FILE}`);
    console.log(`   Review errors.json and re-run to retry failed items`);
  }
}

main().catch(console.error);
