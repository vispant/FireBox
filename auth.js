import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signUp({ email, password, name, captchaToken, country }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      captchaToken,
      data: { name },
    },
  });
  if (error) throw error;

  if (data.user) {
    try {
      await supabase.from("profiles").insert({
        id: data.user.id,
        display_name: name,
        country: country || null,
      });
    } catch (err) {
      console.warn("Could not save profile row.", err);
    }
  }

  return data;
}

export async function signIn({ email, password, captchaToken }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}

export async function fetchCountry() {
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return null;
    const data = await res.json();
    return data.country_name || null;
  } catch {
    return null;
  }
}
