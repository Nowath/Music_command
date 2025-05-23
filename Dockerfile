# ใช้ Node.js เวอร์ชัน 18 ที่รองรับ Discord.js
FROM node:18

# สร้างโฟลเดอร์ใน container
WORKDIR /app

# คัดลอก package.json และ lock file เข้ามา
COPY package*.json ./

# ติดตั้ง dependencies
RUN npm install

# คัดลอกไฟล์อื่นทั้งหมด
COPY . .

# รันบอท
CMD ["npm", "start"]
