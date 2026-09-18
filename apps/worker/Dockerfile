FROM node:20-alpine

# Tesseract et ses donnees francaises pour l'OCR des avis scannes, poppler
# pour rendre une page de PDF en image. Aucun de ces outils n'a d'equivalent
# raisonnable en JavaScript pur, et le CLAUDE.md prevoit Tesseract.
RUN apk add --no-cache \
      tesseract-ocr \
      tesseract-ocr-data-fra \
      poppler-utils

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev"]
