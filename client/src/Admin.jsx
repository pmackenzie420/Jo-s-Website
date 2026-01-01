import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

function Admin() {
    const [password, setPassword] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [orders, setOrders] = useState([]);
    const [hens, setHens] = useState([]);

    // 1. Handle Login
    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            await axios.post(`${API_URL}/admin/login`, { password });
            setIsLoggedIn(true);
            fetchData();
        } catch (err) {
            alert("Wrong password!");
        }
    };

    // 2. Fetch Data (Orders & Hens)
    const fetchData = () => {
        const config = { headers: { 'Authorization': password } };
        
        // Get Orders
        axios.get(`${API_URL}/admin/orders`, config)
            .then(res => setOrders(res.data));
            
        // Get Hens (to update stock)
        axios.get(`${API_URL}/hens`)
            .then(res => setHens(res.data));
    };

    // 3. Update Stock
    const updateStock = async (id, newStock) => {
        try {
            await axios.put(`${API_URL}/admin/hens/${id}`, 
                { stock: newStock }, 
                { headers: { 'Authorization': password } }
            );
            alert("Stock updated!");
            fetchData(); // Refresh data
        } catch (err) {
            console.error(err);
            alert("Failed to update.");
        }
    };

    if (!isLoggedIn) {
        return (
            <div style={{textAlign: 'center', marginTop: '50px'}}>
                <h1>🔒 Admin Login</h1>
                <form onSubmit={handleLogin}>
                    <input 
                        type="password" 
                        placeholder="Enter Password" 
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        style={{padding: '10px', fontSize: '16px'}}
                    />
                    <button type="submit">Login</button>
                </form>
            </div>
        );
    }

    return (
        <div style={{padding: '20px'}}>
            <div style={{display: 'flex', justifyContent: 'space-between'}}>
                <h1>🚜 Farm Dashboard</h1>
                <button onClick={() => window.location.href = '/'}>Back to Store</button>
            </div>

            {/* Inventory Section */}
            <h2>Inventory Management</h2>
            <div className="grid" style={{gridTemplateColumns: '1fr'}}>
                {hens.map(hen => (
                    <div key={hen.id} className="card" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left'}}>
                        <div style={{flex: 1}}>
                            <h3>{hen.name}</h3>
                            <p>Current Stock: <b>{hen.stock}</b></p>
                        </div>
                        <div>
                            <input 
                                type="number" 
                                defaultValue={hen.stock} 
                                id={`stock-${hen.id}`}
                                style={{width: '60px', padding: '5px', marginRight: '10px'}}
                            />
                            <button onClick={() => {
                                const val = document.getElementById(`stock-${hen.id}`).value;
                                updateStock(hen.id, val);
                            }}>Update</button>
                        </div>
                    </div>
                ))}
            </div>

            <hr style={{margin: '40px 0'}} />

            {/* Orders Section */}
            <h2>Recent Orders</h2>
            {orders.length === 0 ? <p>No orders yet.</p> : (
                <table border="1" cellPadding="10" style={{width: '100%', borderCollapse: 'collapse', background: 'white'}}>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Customer</th>
                            <th>Total</th>
                            <th>Items</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => (
                            <tr key={order.id}>
                                <td>{new Date(order.created_at).toLocaleDateString()}</td>
                                <td>{order.customer_email}</td>
                                <td>${(order.total_cents / 100).toFixed(2)}</td>
                                <td>
                                    {/* Parse the JSON items */}
                                    {order.items.map((item, idx) => (
                                        <div key={idx}>
                                            ID: {item.id} (Qty: {item.quantity})
                                        </div>
                                    ))}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

export default Admin;
