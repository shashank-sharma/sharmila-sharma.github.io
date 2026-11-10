import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

try {
  await writeFile(
    new URL("../.dev.vars", import.meta.url),
    [
      'CATALOGUE_PREVIEW="true"',
      'IMAGE_BASE_URL="/media"',
      `STUDIO_PASSWORD="${randomBytes(24).toString("base64url")}"`,
      `SESSION_SECRET="${randomBytes(48).toString("base64url")}"`,
      "",
    ].join("\n"),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Local preview configuration created. Studio credentials are in the git-ignored .dev.vars file; they are never printed.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Using existing .dev.vars configuration.");
}
