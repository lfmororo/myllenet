# Frontend do MyLLENET (build Vite + nginx). Contexto de build = raiz do repo.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm install (não ci): o package-lock da Lovable está defasado e o bun.lock aponta
# para o cache npm privado da Lovable. Sem --legacy-peer-deps: o recharts precisa do react-is (peer).
RUN npm install --no-audit --no-fund
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID=myllenet
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    VITE_BACKEND=supabase
# o .env do repo aponta para a Lovable Cloud — não pode entrar no build
RUN rm -f .env .env.* && npm run build

FROM nginx:1.27-alpine
COPY deploy/vpsfaedi/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
