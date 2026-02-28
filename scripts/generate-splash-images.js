const fs = require("fs");
const path = require("path");

const publicDir = path.join(process.cwd(), "public");
const outputPath = path.join(process.cwd(), "app", "splash-images.json");

const images = fs
  .readdirSync(publicDir)
  .filter((f) => /^splash-.*\.(jpg|jpeg|png|webp)$/i.test(f))
  .sort()
  .map((f) => `/${f}`);

fs.writeFileSync(outputPath, JSON.stringify(images, null, 2) + "\n");
console.log(`Found ${images.length} splash images:`, images);
