import express, { type Request, type Response } from "express"

const useRouter = express.Router()

useRouter.get('/user', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.write('我是测试路由');
  res.end();
});

export { useRouter }