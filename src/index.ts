import Path from 'path';
import Express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import JWT, { JsonWebTokenError } from 'jsonwebtoken';
import request from 'request-promise';
import DiskManager from 'yadisk-mgr';
import MimeTypes from 'mime-types';
import filesize from 'filesize';
import HTTPError from './errors/HTTPError';
import TokenManager, { JWTToken } from './utils/TokenManager';
import checkAuth from './utils/authorization';

const { PORT, TOKEN_LIST, JWT_SECRET } = process.env;

const tokenList = JSON.parse(String(TOKEN_LIST));
const diskManager = new DiskManager(tokenList);

const tokenManager = new TokenManager();

const app = Express();

app.use(helmet({ hsts: false }));
app.use(cors());

app.set('view engine', 'pug');
app.set('views', Path.resolve('src/views'));

app.get('*', async (req: Request, res: Response) => {
  try {
    const uri = await diskManager.getFileLink(req.path);
    request(uri).pipe(res);
  } catch (e1) {
    try {
      const { authorization } = req.headers;
      if (!authorization || !authorization.startsWith('Bearer')) {
        throw new HTTPError(401, 'Access denier');
      }

      const accessToken = authorization.slice(7);
      checkAuth(accessToken);

      const dirList = await diskManager.getDirList(req.path);
      res.status(200).render('dirList', {
        dirList: dirList.map((item) => {
          const path = `${req.path}${req.path.endsWith('/') ? '' : '/'}`;

          return {
            ...item,
            size: item.size ? filesize(item.size) : 'N/A',
            link: `${path}${item.name}`,
          };
        }),
      });
    } catch (e2) {
      if (e2 instanceof HTTPError) {
        res.status(e2.statusCode).send(e2.message);
      }

      res.status(500).send('Internal server error.');
    }
  }
});

app.put('/upload-target/:target', async (req: Request, res: Response) => {
  const { 'content-type': contentType } = req.headers;

  try {
    if (!contentType) {
      throw new HTTPError(400, 'No `Content-Type` header provided.');
    }

    const token = <JWTToken>JWT.verify(req.params.target, String(JWT_SECRET));

    if (tokenManager.has(token)) {
      throw new HTTPError(410, 'Gone.');
    }

    tokenManager.add(token);

    const extension = MimeTypes.extension(contentType);
    if (!extension) {
      throw new HTTPError(415, 'Incorrect `Content-Type` header provided.');
    }

    const path = await diskManager.uploadFile(req, { extension });
    res.status(201).send(path);
  } catch (e) {
    if (e instanceof JsonWebTokenError) {
      res.status(410).send('Gone.');
      return;
    }

    if (e instanceof HTTPError) {
      res.status(e.statusCode).send(e.message);
      return;
    }

    res.status(500).send('Internal server error.');
  }
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  if (!error) {
    next();
  }

  res.status(500).send('Internal server error.');
});

app.listen(Number(PORT));
