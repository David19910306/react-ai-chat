import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// CSS 变量定义在 :root 上，在使用时才求值，因此这里即使晚于组件样式加载也不影响取值
import './index.less'
import './main.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
