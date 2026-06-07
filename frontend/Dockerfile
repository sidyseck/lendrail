FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the source.
COPY . .

EXPOSE 5173

# Vite dev server. --host so it binds 0.0.0.0 inside the container.
CMD ["npm", "run", "dev", "--", "--host"]
