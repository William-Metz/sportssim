FROM node:20-alpine

# Install Python3 + pip for ML engine
RUN apk add --no-cache python3 py3-pip py3-numpy py3-scipy && \
    pip3 install --break-system-packages scikit-learn pandas

WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . .

# Create ml-models dir for trained model cache
RUN mkdir -p services/ml-models

EXPOSE 8080
CMD ["node", "server.js"]
