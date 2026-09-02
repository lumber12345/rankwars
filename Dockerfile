FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
