/** @type {import("next").NextConfig} */
const normalizeBasePath = (value) => {
  if (!value) {
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
};

const nextConfig = {
  reactStrictMode: true,
  basePath: normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH)
};

module.exports = nextConfig;
