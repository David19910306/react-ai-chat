import { StrictMode } from 'react'
import { RouterProvider } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { App as AntdApp } from 'antd'
import router from './router'

import './index.less'
import './main.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AntdApp>
      <RouterProvider router={router} />
    </AntdApp>
  </StrictMode>,
)
