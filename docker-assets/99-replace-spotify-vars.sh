#!/bin/bash

if [ -z "${SPOTIFY_CLIENT_ID}" ]; then
  echo "ERROR: SPOTIFY_CLIENT_ID not set"
  exit 1
fi

if [ -z "${SPOTIFY_REDIRECT_URI}" ]; then
  echo "ERROR: SPOTIFY_REDIRECT_URI not set"
  exit 1
fi

sed -i "s,REPLACEME_VITE_SPOTIFY_CLIENT_ID,${SPOTIFY_CLIENT_ID}," /usr/share/nginx/html/assets/index*.js
sed -i "s,REPLACEME_VITE_SPOTIFY_REDIRECT_URI,${SPOTIFY_REDIRECT_URI}," /usr/share/nginx/html/assets/index*.js
