import { supabase } from "./auth.js?v=1";

export function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function roomChannelName(code) {
  return `firebox-snake-arena-${code}`;
}

export function createRoomChannel(code, presenceKey) {
  return supabase.channel(roomChannelName(code), {
    config: { presence: { key: presenceKey } },
  });
}

// Call this only AFTER attaching all .on('broadcast'|'presence', ...) handlers —
// supabase-js requires listeners to be registered before subscribe() is called.
export function subscribeRoom(channel, presenceMeta) {
  return new Promise((resolve) => {
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        if (presenceMeta) await channel.track(presenceMeta);
        resolve(channel);
      }
    });
  });
}

export function closeRoom(channel) {
  if (channel) supabase.removeChannel(channel);
}

export function countPresence(channel) {
  if (!channel) return 0;
  return Object.keys(channel.presenceState()).length;
}

// --- Room directory (Postgres-backed) for "Play Online" auto-matchmaking ---
// Realtime channels aren't listable from the client, so a small table is the only
// way to answer "is there an open game right now?". See supabase_setup_arena_rooms.sql.

const ROOM_STALE_MS = 20000;

export async function findAvailableRoom(capacity) {
  const staleCutoff = new Date(Date.now() - ROOM_STALE_MS).toISOString();
  try {
    const { data, error } = await supabase
      .from("arena_rooms")
      .select("code, player_count, updated_at")
      .lt("player_count", capacity)
      .gte("updated_at", staleCutoff)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error || !data || data.length === 0) return null;
    return data[Math.floor(Math.random() * data.length)].code;
  } catch {
    return null;
  }
}

export async function registerPublicRoom(code, hostId) {
  try {
    await supabase.from("arena_rooms").upsert({
      code,
      host_id: hostId,
      player_count: 1,
      updated_at: new Date().toISOString(),
    });
  } catch {}
}

export async function heartbeatRoom(code, playerCount) {
  try {
    await supabase
      .from("arena_rooms")
      .update({ player_count: playerCount, updated_at: new Date().toISOString() })
      .eq("code", code);
  } catch {}
}

export async function removeRoom(code) {
  try {
    await supabase.from("arena_rooms").delete().eq("code", code);
  } catch {}
}
