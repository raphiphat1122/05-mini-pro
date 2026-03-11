import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("shop.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT NOT NULL,
    description TEXT,
    stock INTEGER DEFAULT 0,
    category TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'Pending',
    shipping_name TEXT,
    shipping_address TEXT,
    shipping_phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    price REAL,
    FOREIGN KEY(order_id) REFERENCES orders(id),
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
`);

// Seed Admin if not exists
const admin = db.prepare("SELECT * FROM users WHERE email = ?").get("admin@example.com");
if (!admin) {
  db.prepare("INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)").run(
    "Admin",
    "admin@example.com",
    "admin",
    "admin"
  );
}

// Seed some products if empty
const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
if (productCount.count === 0) {
  const seedProducts = [
    { name: "Minimalist Lamp", price: 89.00, image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&q=80&w=800", description: "A sleek black desk lamp for modern spaces.", stock: 15, category: "Lighting" },
    { name: "Ceramic Vase", price: 45.00, image: "https://images.unsplash.com/photo-1581783898377-1c85bf937427?auto=format&fit=crop&q=80&w=800", description: "Handcrafted white ceramic vase.", stock: 20, category: "Decor" },
    { name: "Cotton Tote", price: 25.00, image: "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&q=80&w=800", description: "Eco-friendly sustainable cotton bag.", stock: 50, category: "Accessories" },
    { name: "Oak Chair", price: 150.00, image: "https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&q=80&w=800", description: "Premium solid oak chair with ergonomic design.", stock: 10, category: "Furniture" }
  ];
  const insert = db.prepare("INSERT INTO products (name, price, image, description, stock, category) VALUES (@name, @price, @image, @description, @stock, @category)");
  seedProducts.forEach(p => insert.run(p));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Auth Routes
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND password = ?").get(email, password) as any;
    if (user) {
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } else {
      res.status(401).json({ error: "Invalid email or password" });
    }
  });

  app.post("/api/auth/register", (req, res) => {
    const { username, email, password } = req.body;
    try {
      const result = db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)").run(username, email, password);
      res.json({ id: result.lastInsertRowid, username, email, role: 'user' });
    } catch (e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  // Product Routes
  app.get("/api/products", (req, res) => {
    const products = db.prepare("SELECT * FROM products").all();
    res.json(products);
  });

  app.get("/api/products/:id", (req, res) => {
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
    if (product) res.json(product);
    else res.status(404).json({ error: "Product not found" });
  });

  app.post("/api/products", (req, res) => {
    const { name, price, image, description, stock, category } = req.body;
    const result = db.prepare("INSERT INTO products (name, price, image, description, stock, category) VALUES (?, ?, ?, ?, ?, ?)").run(name, price, image, description, stock, category);
    res.json({ id: result.lastInsertRowid, ...req.body });
  });

  app.put("/api/products/:id", (req, res) => {
    const { name, price, image, description, stock, category } = req.body;
    db.prepare("UPDATE products SET name = ?, price = ?, image = ?, description = ?, stock = ?, category = ? WHERE id = ?").run(name, price, image, description, stock, category, req.params.id);
    res.json({ id: req.params.id, ...req.body });
  });

  app.delete("/api/products/:id", (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Order Routes
  app.post("/api/orders", (req, res) => {
    const { userId, totalPrice, items } = req.body;
    
    const transaction = db.transaction(() => {
      const orderResult = db.prepare("INSERT INTO orders (user_id, total_price) VALUES (?, ?)").run(userId, totalPrice);
      const orderId = orderResult.lastInsertRowid;

      const itemInsert = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)");
      const stockUpdate = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

      for (const item of items) {
        itemInsert.run(orderId, item.productId, item.quantity, item.price);
        stockUpdate.run(item.quantity, item.productId);
      }
      return orderId;
    });

    try {
      const orderId = transaction();
      res.json({ id: orderId, status: 'pending' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  app.get("/api/orders", (req, res) => {
    const { userId, role } = req.query;
    let orders;
    if (role === 'admin') {
      orders = db.prepare("SELECT o.*, u.username as user_name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY created_at DESC").all();
    } else {
      orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC").all(userId);
    }
    res.json(orders);
  });

  app.get("/api/stats", (req, res) => {
    const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as any;
    const orderCount = db.prepare("SELECT COUNT(*) as count FROM orders").get() as any;
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
    const revenue = db.prepare("SELECT SUM(total_price) as total FROM orders").get() as any;
    res.json({
      totalProducts: productCount.count,
      totalOrders: orderCount.count,
      totalUsers: userCount.count,
      totalRevenue: revenue.total || 0
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
