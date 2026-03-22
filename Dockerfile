FROM node:20-slim

# Install Python3 with ML dependencies for the ML bridge
# XGBoost + LightGBM = 45%+20% of ensemble weight — CRITICAL for accuracy
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-numpy python3-scipy libgomp1 && \
    pip3 install --break-system-packages --no-cache-dir scikit-learn pandas xgboost lightgbm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . .

# Create ml-models dir for trained model cache
RUN mkdir -p services/ml-models

EXPOSE 8080
CMD ["node", "server.js"]
