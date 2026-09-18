FROM node:20-alpine

WORKDIR /app

# Les dependances sont installees dans l'image, jamais montees depuis l'hote :
# un node_modules Windows monte dans un conteneur Linux casse les binaires.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
