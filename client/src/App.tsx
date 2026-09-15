import { RouterProvider } from 'react-router-dom';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import router from './router';
import { useTheme } from './hooks/useTheme';

export default function App() {
  const { isDark } = useTheme();

  return (
    <ConfigProvider
      theme={{
        // antd 组件跟随手动选择/系统偏好；自定义样式由 index.less 的 CSS 变量负责
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        // 与 index.less 的 --primary 保持一致，让 antd 按钮和自定义样式同色
        token: { colorPrimary: '#3b82f6' },
      }}
    >
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  );
}
