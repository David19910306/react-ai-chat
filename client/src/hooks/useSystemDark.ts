import { useEffect, useState } from 'react';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * 跟随系统深色模式。
 * 自定义样式走 index.less 里的 CSS 变量，靠 prefers-color-scheme 自动切换；
 * 但 antd 是 CSS-in-JS，不认这些变量，必须显式切 theme.darkAlgorithm，
 * 否则暗色下登录页的 Card/Form/Input 仍是白底。
 */
export default function useSystemDark(): boolean {
  const [isDark, setIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return isDark;
}


