const PLAYER_KEY = "zombonk_player";
const TOKEN_KEY = "zombonk_token";
const MOD_KEY = "zombonk_mod_password";

export interface StoredPlayer {
  id: number;
  name: string;
}

export function getStoredPlayer(): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(PLAYER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredPlayer;
  } catch {
    return null;
  }
}

export function setStoredPlayer(player: StoredPlayer): void {
  localStorage.setItem(PLAYER_KEY, JSON.stringify(player));
}

export function clearStoredPlayer(): void {
  localStorage.removeItem(PLAYER_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getModPassword(): string | null {
  return localStorage.getItem(MOD_KEY);
}

export function setModPassword(pw: string): void {
  localStorage.setItem(MOD_KEY, pw);
}

export function clearModPassword(): void {
  localStorage.removeItem(MOD_KEY);
}
