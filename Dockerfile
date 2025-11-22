FROM node:18 AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Build app
COPY . .
# We set the environment variables to fixed strings that will later be replaced during startup in the nginx container
ENV VITE_SPOTIFY_CLIENT_ID="REPLACEME_VITE_SPOTIFY_CLIENT_ID"
ENV VITE_SPOTIFY_REDIRECT_URI="REPLACEME_VITE_SPOTIFY_REDIRECT_URI"
RUN npm run build

# Prepare nginx container
FROM nginx:latest
COPY docker-assets/99-replace-spotify-vars.sh docker-entrypoint.d/
COPY --from=build /app/dist /usr/share/nginx/html
