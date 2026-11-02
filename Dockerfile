FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["node", "server.js"]
