export interface User {
  id: number;
  username: string;
  email: string;
  role: 'user' | 'admin';
}

export interface Product {
  id: number;
  name: string;
  price: number;
  image: string;
  description: string;
  stock: number;
  category: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Order {
  id: number;
  user_id: number;
  user_name?: string;
  total_price: number;
  status: 'Pending' | 'Shipping' | 'Completed' | 'Cancelled';
  shipping_name: string;
  shipping_address: string;
  shipping_phone: string;
  created_at: string;
}
