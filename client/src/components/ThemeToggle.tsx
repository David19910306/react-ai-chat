import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';

const MODE_META: Record<ThemeMode, { label: string; Icon: typeof SunIcon }> = {
  system: { label: '跟随系统', Icon: MonitorIcon },
  light: { label: '亮色', Icon: SunIcon },
  dark: { label: '暗色', Icon: MoonIcon },
};

type Props = {
  /**
   * menu：侧边栏菜单项形态，复用 .chat-menu-item 的外观，窄屏自动收成只留图标
   * icon：登录页右上角的悬浮按钮
   */
  variant?: 'menu' | 'icon';
};

export default function ThemeToggle({ variant = 'menu' }: Props) {
  const { mode, cycleMode } = useTheme();
  const { label, Icon } = MODE_META[mode];
  // 按钮形态固定，靠 title 说明当前处于哪一档，避免三态循环时看不出状态
  const hint = `当前：${label}，点击切换`;

  if (variant === 'icon') {
    return (
      <button type='button' className='theme-toggle-icon' onClick={cycleMode} title={hint} aria-label={hint}>
        <Icon size={18} />
      </button>
    );
  }

  return (
    <button type='button' className='chat-menu-item theme-toggle-item' onClick={cycleMode} title={hint}>
      <Icon size={18} />
      <span className='chat-menu-label'>{label}</span>
    </button>
  );
}
