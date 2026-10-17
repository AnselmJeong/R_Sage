// Renders an SVG to a PNG with Chromium so filters and gradients match a browser.
import { chromium } from "playwright-core";
import { readFileSync } from "fs";
const [,, svg, out, size = "1024", bg = "transparent"] = process.argv;
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage({ viewport: { width: +size, height: +size } });
await p.setContent(`<html><body style="margin:0;background:${bg}"><img src="data:image/svg+xml;base64,${readFileSync(svg).toString("base64")}" width="${size}" height="${size}" style="display:block"></body></html>`);
await p.waitForLoadState("networkidle");
await p.screenshot({ path: out, omitBackground: bg === "transparent" });
await b.close();
