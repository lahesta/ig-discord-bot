// ─── Tyypit ─────────────────────────────────────────

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
  initialized: boolean;
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

const FB_ACCESS_TOKEN = env("IG_ACCESS_TOKEN");
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

// ─── Facebook Graph API → Instagram ─────────────────

const FB_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Hakee Instagram Business Account ID:n Facebook-tokenin kautta.
 * Polku: Token → /me/accounts → Page → instagram_business_account
 */
async function resolveIGUserId(): Promise<string> {
  const url = `${FB_API_BASE}/me/accounts?fields=id,name,instagram_business_account&access_token=${FB_ACCESS_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Facebook Pages -haku epäonnistui: ${res.status} – ${err}`);
  }

  const data = await res.json();
  const pages = data.data ?? [];

  for (const page of pages) {
    if (page.instagram_business_account?.id) {
      console.log(`📎 Löytyi IG-tili sivulta "${page.name}" → IG User ID: ${page.instagram_business_account.id}`);
      return page.instagram_business_account.id;
    }
  }

  throw new Error(
    "❌ Yhdeltäkään Facebook-sivulta ei löytynyt linkitettyä Instagram Business -tiliä. " +
    "Varmista, että Instagram-tili on yhdistetty Facebook-sivuun ja että token sisältää pages_show_list ja instagram_basic -oikeudet."
  );
}

/**
 * Tarkistaa tokenin tilan ja varoittaa jos se on vanhenemassa.
 */
async function checkTokenHealth(): Promise<void> {
  const url = `${FB_API_BASE}/debug_token?input_token=${FB_ACCESS_TOKEN}&access_token=${FB_ACCESS_TOKEN}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return; // Ei kriittinen – jatketaan normaalisti

    const data = await res.json();
    const info = data.data;

    if (info?.expires_at) {
      const expiresAt = new Date(info.expires_at * 1000);
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      if (daysLeft <= 0) {
        console.error("🔴 TOKEN ON VANHENTUNUT! Uusi token tarvitaan.");
      } else if (daysLeft <= 7) {
        console.warn(`🟡 Token vanhenee ${daysLeft} päivän päästä (${expiresAt.toISOString()}). Uusi se pian!`);
      } else {
        console.log(`🟢 Token voimassa ${daysLeft} päivää (vanhenee ${expiresAt.toLocaleDateString("fi-FI")})`);
      }
    }

    if (info?.scopes) {
      console.log(`🔑 Token-oikeudet: ${info.scopes.join(", ")}`);
    }
  } catch {
    // Token debug N/A
  }
}

async function fetchRecentPosts(igUserId: string): Promise<IGMedia[]> {
  const fields = "id,caption,media_url,permalink,timestamp,media_type,thumbnail_url";
  const url = `${FB_API_BASE}/${igUserId}/media?fields=${fields}&limit=10&access_token=${FB_ACCESS_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Instagram API virhe (media): ${res.status} – ${err}`);
  }

  const data = await res.json();
  return data.data ?? [];
}

async function fetchStories(igUserId: string): Promise<IGStory[] | null> {
  const fields = "id,media_url,timestamp,media_type";
  const url = `${FB_API_BASE}/${igUserId}/stories?fields=${fields}&access_token=${FB_ACCESS_TOKEN}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) {
      console.log("ℹ️  Ei aktiivisia storyja tällä hetkellä.");
      return null;
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
        ? "🎠 Kuvakaruselli"
        : "📷 Kuva";

  const caption = post.caption
    ? post.caption.length > 300
      ? post.caption.slice(0, 300) + "…"
      : post.caption
    : "";

  return {
    title: `Uusi julkaisu: ${typeLabel}`,
    description: caption,
    url: post.permalink,
    color: 0xe1306c,
    image: post.media_url ? { url: post.media_url } : undefined,
    timestamp: post.timestamp,
    footer: { text: `@${IG_USERNAME}` },
  };
}

function buildStoryEmbed(story: IGStory): DiscordEmbed {
  const typeLabel = story.media_type === "VIDEO" ? "🎬 Video" : "📷 Kuva";

  return {
    title: `Uusi story: ${typeLabel}`,
    url: `https://www.instagram.com/stories/${IG_USERNAME}/`,
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
    return { lastPostIds: [], lastStoryIds: [], lastRun: "", initialized: false };
  }

  const gist = await res.json();
  const file = gist.files?.[GIST_FILENAME];

  if (!file?.content) {
    return { lastPostIds: [], lastStoryIds: [], lastRun: "", initialized: false };
  }

  try {
    const parsed = JSON.parse(file.content);
    return {
      lastPostIds: parsed.lastPostIds ?? [],
      lastStoryIds: parsed.lastStoryIds ?? [],
      lastRun: parsed.lastRun ?? "",
      initialized: parsed.initialized ?? false,
    };
  } catch {
    return { lastPostIds: [], lastStoryIds: [], lastRun: "", initialized: false };
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

  // Tarkista tokenin tila
  await checkTokenHealth();

  // Hae IG User ID Facebook-tokenin kautta
  const igUserId = await resolveIGUserId();

  const state = await loadState();
  console.log(`📦 Edellinen tila: ${state.lastPostIds.length} tunnettua julkaisua, ${state.lastStoryIds.length} tunnettua storyä`);

  const posts = await fetchRecentPosts(igUserId);
  console.log(`📬 Haettu ${posts.length} julkaisua Instagramista`);

  const storiesResult = await fetchStories(igUserId);
  const stories = storiesResult ?? [];
  const storiesFetchOk = storiesResult !== null;
  console.log(`📬 Haettu ${stories.length} storyä Instagramista${!storiesFetchOk ? " (haku epäonnistui, käytetään edellistä tilaa)" : ""}`);

  // Ensimmäisellä ajolla tallennetaan nykytila ilman ilmoituksia
  if (!state.initialized) {
    console.log("🔧 Ensimmäinen ajo — tallennetaan nykytila ilman ilmoituksia.");

    const newState: BotState = {
      lastPostIds: posts.map((p) => p.id),
      lastStoryIds: stories.map((s) => s.id),
      lastRun: new Date().toISOString(),
      initialized: true,
    };

    await saveState(newState);
    console.log("💾 Tila tallennettu. Seuraavasta ajosta lähtien ilmoitukset ovat käytössä.");
    return;
  }

  const newPosts = posts.filter((p) => !state.lastPostIds.includes(p.id));
  console.log(`🆕 Uusia julkaisuja: ${newPosts.length}`);

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
    lastStoryIds: storiesFetchOk ? stories.map((s) => s.id) : state.lastStoryIds,
    lastRun: new Date().toISOString(),
    initialized: true,
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
