import { useCallback, useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'chat-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
// 按钮的循环顺序：跟随系统 → 亮色 → 暗色 → 跟随系统
const MODE_ORDER: ThemeMode[] = ['system', 'light', 'dark'];

const darkMedia = window.matchMedia(DARK_QUERY);

// 模块级单例状态。App / Home / Login 都通过 useTheme 读写同一份，
// 因此不需要 Context Provider 也不会各自为政
const listeners = new Set<() => void>();
let mode: ThemeMode = readStoredMode();

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // 隐私模式等场景下 localStorage 可能直接抛错，退回跟随系统
    return 'system';
  }
}

// 把结果落到 <html data-theme>：index.less 靠它压过 prefers-color-scheme，
// 原生控件的 color-scheme 也一并跟着切。
// 'system' 时移除属性，把决定权交还媒体查询
function applyTheme() {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

function subscribeMode(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getMode() {
  return mode;
}

function subscribeSystemDark(onChange: () => void) {
  darkMedia.addEventListener('change', onChange);
  return () => {
    darkMedia.removeEventListener('change', onChange);
  };
}

function getSystemDark() {
  return darkMedia.matches;
}

function setMode(next: ThemeMode) {
  mode = next;
  try {
    // 'system' 不落盘，这样下次改系统偏好时仍能自动跟随
    if (next === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 写入失败不影响本次会话内的切换
  }
  applyTheme();
  listeners.forEach((onChange) => onChange());
}

export function useTheme() {
  // 两个快照都是原始值，useSyncExternalStore 不会因引用变化而反复重渲染
  const currentMode = useSyncExternalStore(subscribeMode, getMode);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark);

  const cycleMode = useCallback(() => {
    setMode(MODE_ORDER[(MODE_ORDER.indexOf(currentMode) + 1) % MODE_ORDER.length]);
  }, [currentMode]);

  return {
    mode: currentMode,
    // 只有 mode 为 'system' 时才需要读系统偏好
    isDark: currentMode === 'system' ? systemDark : currentMode === 'dark',
    setMode,
    cycleMode,
  };
}
