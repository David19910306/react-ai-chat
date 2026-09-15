import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Tabs, App as AntdApp } from 'antd';
import { loginApi, registerApi } from '@/api/user';
import ThemeToggle from '@/components/ThemeToggle';
import { setToken } from '@/utils/auth';

type FormValues = {
  username: string;
  password: string;
  address?: string;
  tel?: string;
  email?: string;
};

export default function Login() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('login');

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      if (tab === 'register') {
        await registerApi({
          username: values.username,
          password: values.password,
          address: values.address,
          tel: values.tel,
          email: values.email,
        });
        message.success('注册成功，请登录');
        setTab('login');
        return;
      }

      const user = await loginApi(values.username, values.password);
      if (user.token) setToken(user.token);
      message.success(`欢迎回来，${user.username}`);
      navigate('/', { replace: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  const loginForm = (
    <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input placeholder="用户名 / 邮箱 / 手机号" size="large" autoComplete="username" />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password placeholder="请输入密码" size="large" autoComplete="current-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block size="large" loading={loading}>
        登录
      </Button>
    </Form>
  );

  const registerForm = (
    <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input placeholder="请输入用户名" size="large" autoComplete="username" />
      </Form.Item>
      <Form.Item
        name="password"
        label="密码"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 6, message: '密码至少 6 位' },
        ]}
      >
        <Input.Password placeholder="请输入密码" size="large" autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="tel"
        label="手机号"
        rules={[
          { required: true, message: '请输入手机号' },
          { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
        ]}
      >
        <Input placeholder="请输入手机号" size="large" autoComplete="tel" maxLength={11} />
      </Form.Item>
      <Form.Item
        name="email"
        label="邮箱"
        rules={[
          { required: true, message: '请输入邮箱' },
          { type: 'email', message: '请输入正确的邮箱' },
        ]}
      >
        <Input placeholder="请输入邮箱" size="large" autoComplete="email" />
      </Form.Item>
      <Form.Item
        name="address"
        label="地址"
        rules={[{ required: true, message: '请输入地址' }]}
      >
        <Input placeholder="请输入地址" size="large" autoComplete="street-address" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block size="large" loading={loading}>
        注册
      </Button>
    </Form>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-(--bg) px-4 py-6">
      <ThemeToggle variant="icon" />
      <Card className="w-96 shadow-sm" styles={{ body: { paddingTop: 8 } }}>
        <h1 className="text-center text-3xl font-bold mb-2" style={{ color: 'var(--brand)', fontFamily: "Cambria, Cochin, Georgia, Times, 'Times New Roman', serif" }}>
          chat-ai
        </h1>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          centered
          items={[
            { key: 'login', label: '登录', children: loginForm },
            { key: 'register', label: '注册', children: registerForm },
          ]}
        />
      </Card>
    </div>
  );
}
