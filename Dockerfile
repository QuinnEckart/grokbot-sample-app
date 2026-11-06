# Portable Node image for local runs and DigitalOcean App Platform docker builds.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>r.text().then(t=>process.exit(r.ok&&t.trim()==='ok'?0:1))).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
