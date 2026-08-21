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
