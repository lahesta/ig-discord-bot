// ─── Tyypit ──────────────────────────────────────────

interface IGMedia {
  id: string;
  caption?: string;
  media_url?: string;
  permalink?: string;
  timestamp: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  thumbnail_url?: string;
}

interface IGStory {
  id: string;
  media_url?: string;
  timestamp: string;
  media_type: "IMAGE" | "VIDEO";
}

interface BotState {
  lastPostIds: string[];
  lastStoryIds: string[];
  lastRun: string;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  image?: { url: string };
  thumbnail?: { url: string };
  timestamp?: string;
  footer?: { text: string };
}

// ─── Ympäristömuuttujat ─────────────────────────────

const IG_ACCESS_TOKEN = env("IG_ACCESS_TOKEN");
const DISCORD_WEBHOOK_URL = env("DISCORD_WEBHOOK_URL");
const GITHUB_TOKEN = env("GITHUB_TOKEN");
const GIST_ID = env("GIST_ID");
const IG_USERNAME = process.env.IG_USERNAME || "instagram";

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Ympäristömuuttuja ${name} puuttuu!`);
  }
  return value;
}

// ─── Instagram Graph API ────────────────────────────

const IG_API_BASE = "https://graph.instagram.com/v21.0";

async function fetchRecentPosts(): Promise<IGMedia[]> {
  const fields = "id,caption,media_url,permalink,timestamp,media_type,thumbnail_url";
  const url = `${IG_API_BASE}/me/media?fields=${fields}&limit=10&access_token=${IG_ACCESS_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Instagram API virhe (media): ${res.status} – ${err}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

async function fetchStories(): Promise<IGStory[]> {
  const f
