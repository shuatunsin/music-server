import express from "express";
import YTMusic from "ytmusic-api";
import { spawn } from "child_process";

const app = express();
const PORT = process.env.PORT || 3099;

const ytm = new YTMusic();
await ytm.initialize();

function getAudioUrl(videoId) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "-g",
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
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
