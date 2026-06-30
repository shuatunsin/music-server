import express from "express";
import YTMusic from "ytmusic-api";
import { spawn, execSync } from "child_process";
import ytdl from "@distube/ytdl-core";

const app = express();
const PORT = process.env.PORT || 3099;

const ytm = new YTMusic();
await ytm.initialize();

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Try to find yt-dlp in common locations
function findYtdl() {
  try {
    const p = execSync("which yt-dlp", { encoding: "utf8" }).trim();
    if (p) console.log("yt-dlp found at:", p);
    return p || "yt-dlp";
  } catch {
    console.log("yt-dlp not found on PATH");
    return null;
  }
}

const YTDL_PATH = findYtdl();

async function getAudioUrl(videoId) {
  // Try yt-dlp first
  if (YTDL_PATH) {
    try {
      const url = await spawnYtdl(YTDL_PATH, videoId);
      if (url) return url;
    } catch (e) {
      console.warn("yt-dlp failed, trying ytdl-core:", e.message);
    }
  }

  // Fallback to ytdl-core
  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
      requestOptions: { headers: { "User-Agent": USER_AGENT } },
    });
    const format = info.formats.find((f) => f.itag === 140 && f.url) ||
      info.formats.find((f) => f.itag === 18 && f.url) ||
      info.formats.find((f) => f.hasAudio && f.url);
    if (format?.url) return format.url;
  } catch (e) {
    console.warn("ytdl-core also failed:", e.message);
  }

  throw new Error("Could not get audio URL");
}

function spawnYtdl(cmd, videoId) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, [
      "-g", "-f", "bestaudio[ext=m4a]/bestaudio",
      `https://www.youtube.com/watch?v=${videoId}`,
    ], {
      env: { ...process.env, PATH: process.env.PATH },
      timeout: 30000,
    });
    let url = "";
    proc.stdout.on("data", (d) => (url += d.toString()));
    proc.on("close", (code) => {
      if (code === 0 && url.trim()) resolve(url.trim());
      else reject(new Error(`yt-dlp exited ${code}`));
    });
    proc.on("error", reject);
  });
}

function processThumbnail(r) {
  let url = r.thumbnails?.pop()?.url || "";
  if (r.videoId) {
    url = `https://i.ytimg.com/vi/${r.videoId}/maxresdefault.jpg`;
  }
  return url;
}

function trackMapper(r) {
  return {
    videoId: r.videoId,
    title: r.name || r.title,
    artist: r.artist?.name || r.artists?.[0]?.name || "",
    artistId: r.artist?.artistId || "",
    album: r.album?.name || "",
    duration: r.duration || 0,
    thumbnail: processThumbnail(r),
  };
}

function artistMapper(a) {
  return {
    artistId: a.artistId || a.channelId || "",
    name: a.name || "",
    thumbnail: a.thumbnails?.pop()?.url?.replace("w120-h120", "w400-h400") || "",
    subscribers: a.subscribers || "",
    songsCount: a.songsCount || 0,
  };
}

app.get("/search", async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: "missing query" });
    const [songs, artists] = await Promise.all([
      ytm.searchSongs(q),
      ytm.searchArtists(q),
    ]);
    res.json({
      songs: songs.map(trackMapper),
      artists: artists.map(artistMapper).slice(0, 3),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/stream/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params;
    if (!videoId) return res.status(400).json({ error: "missing videoId" });
    const url = await getAudioUrl(videoId);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/related", async (req, res) => {
  try {
    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: "missing videoId" });
    const song = await ytm.getSong(videoId);
    const related = await ytm.getUpNexts(videoId, { limit: 15 });
    res.json(related.map(trackMapper).filter((r) => r.videoId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/artist/:artistId", async (req, res) => {
  try {
    const { artistId } = req.params;
    if (!artistId) return res.status(400).json({ error: "missing artistId" });
    const artist = await ytm.getArtist(artistId);
    const songs = await ytm.getArtistSongs(artistId, { limit: 30 });
    res.json({
      name: artist.name || "",
      thumbnail: artist.thumbnails?.pop()?.url || "",
      subscribers: artist.subscribers || "",
      songs: songs.map(trackMapper),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`YT Music server running on http://localhost:${PORT}`);
});
