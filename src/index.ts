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
  const fields = "id,media_url,timestamp,media_type";
  const url = `${IG_API_BASE}/me/stories?fields=${fields}&access_token=${IG_ACCESS_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) {
      console.log("ℹ️  Ei aktiivisia storyja (tai API ei tue niitä).");
      return [];
    }
    const err = await res.text();
    throw new Error(`Instagram API virhe (stories): ${res.status} – ${err}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

// ─── Discord Webhook ────────────────────────────────

async function sendDiscordEmbed(embeds: DiscordEmbed[]): Promise<void> {
  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `📸 ${IG_USERNAME} • Instagram`,
      embeds,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord webhook virhe: ${res.status} – ${err}`);
  }
}

function buildPostEmbed(post: IGMedia): DiscordEmbed {
  const typeLabel =
    post.media_type === "VIDEO"
      ? "🎬 Video"
      : post.media_type === "CAROUSEL_ALBUM"
        ? "🎠 Karuselli"
        : "📷 Kuva";

  const caption = post.caption
    ? post.caption.length > 300
      ? post.caption.slice(0, 300) + "…"
      : post.caption
    : "";

  return {
    title: `Uusi julkaisu! ${typeLabel}`,
    description: caption,
    url: post.permalink,
    color: 0xe1306c,
    image: post.media_url ? { url: post.media_url } : undefined,
    timestamp: post.timestamp,
    footer: { text: `@${IG_USERNAME}` },
  };
}

function buildStoryEmbed(story: IGStory): DiscordEmbed {
  const typeLabel = story.media_type === "VIDEO" ? "🎬 Video Story" : "📷 Story";

  return {
    title: `Uusi story! ${typeLabel}`,
    color: 0xc13584,
    image: story.media_url ? { url: story.media_url } : undefined,
    timestamp: story.timestamp,
    footer: { text: `@${IG_USERNAME}` },
  };
}

// ─── Tilan hallinta (GitHub Gist) ───────────────────

const GIST_FILENAME = "ig-discord-bot-state.json";

async function loadState(): Promise<BotState> {
  const url = `https://api.github.com/gists/${GIST_ID}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    console.log("⚠️  Gistiä ei löytynyt tai ei voitu lukea. Aloitetaan tyhjästä.");
    return { lastPostIds: [], lastStoryIds: [], lastRun: "" };
  }

  const gist = await res.json();
  const file = gist.files?.[GIST_FILENAME];

  if (!file?.content) {
    return { lastPostIds: [], lastStoryIds: [], lastRun: "" };
  }

  try {
    return JSON.parse(file.content);
  } catch {
    return { lastPostIds: [], lastStoryIds: [], lastRun: "" };
  }
}

async function saveState(state: BotState): Promise<void> {
  const url = `https://api.github.com/gists/${GIST_ID}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(state, null, 2),
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gist-tallennus epäonnistui: ${res.status} – ${err}`);
  }
}

// ─── Päälogiikka ────────────────────────────────────

async function main() {
  console.log(`🚀 Instagram → Discord bot käynnistyy (${new Date().toISOString()})`);

  const state = await loadState();
  console.log(`📦 Edellinen tila: ${state.lastPostIds.length} tunnettua julkaisua, ${state.lastStoryIds.length} tunnettua storyä`);

  const posts = await fetchRecentPosts();
  console.log(`📬 Haettu ${posts.length} julkaisua Instagramista`);

  const newPosts = posts.filter((p) => !state.lastPostIds.includes(p.id));
  console.log(`🆕 Uusia julkaisuja: ${newPosts.length}`);

  const stories = await fetchStories();
  console.log(`📬 Haettu ${stories.length} storyä Instagramista`);

  const newStories = stories.filter((s) => !state.lastStoryIds.includes(s.id));
  console.log(`🆕 Uusia storyja: ${newStories.length}`);

  for (const post of newPosts.reverse()) {
    console.log(`📤 Lähetetään julkaisu ${post.id}...`);
    await sendDiscordEmbed([buildPostEmbed(post)]);
    await sleep(1000);
  }

  for (const story of newStories.reverse()) {
    console.log(`📤 Lähetetään story ${story.id}...`);
    await sendDiscordEmbed([buildStoryEmbed(story)]);
    await sleep(1000);
  }

  const newState: BotState = {
    lastPostIds: posts.map((p) => p.id),
    lastStoryIds: stories.map((s) => s.id),
    lastRun: new Date().toISOString(),
  };

  await saveState(newState);
  console.log("💾 Tila tallennettu.");

  const total = newPosts.length + newStories.length;
  if (total > 0) {
    console.log(`✅ Lähetetty ${total} uutta ilmoitusta Discordiin!`);
  } else {
    console.log("✅ Ei uutta sisältöä. Odotetaan seuraavaa tarkistusta.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("❌ Virhe:", err);
  process.exit(1);
});
