import axios from 'axios';
import { API_URL } from '../constants/api';

const withAuth = { withCredentials: true };

const login = (password) =>
  axios.post(`${API_URL}/admin/login`, { password }, withAuth);

const checkSession = () => axios.get(`${API_URL}/admin/session`, withAuth);

const fetchAdminMeta = () => axios.get(`${API_URL}/admin/meta`, withAuth);

const fetchOrdersPage = ({ limit = 500, offset = 0 } = {}) =>
  axios.get(`${API_URL}/admin/orders-page`, { ...withAuth, params: { limit, offset } });

const updatePickupStock = ({ date, location, items }) =>
  axios.put(`${API_URL}/admin/pickup-stock`, { date, location, items }, withAuth);

const addPickupDate = ({ dateValue, location }) =>
  axios.post(
    `${API_URL}/admin/pickup-dates`,
    { date_value: dateValue, location },
    withAuth
  );

const updatePickupDate = ({ dateId, dateValue, emailUsers = false }) =>
  axios.put(
    `${API_URL}/admin/pickup-dates/${dateId}`,
    { date_value: dateValue, email_users: emailUsers },
    withAuth
  );

const deletePickupDate = (dateId) =>
  axios.delete(`${API_URL}/admin/pickup-dates/${dateId}`, withAuth);

const updateOrdersStatus = ({ ids, status }) =>
  axios.put(`${API_URL}/admin/orders/status`, { ids, status }, withAuth);

const createAdminOrder = (payload) =>
  axios.post(`${API_URL}/admin/orders`, payload, withAuth);

const updateAdminOrder = ({ orderId, payload }) =>
  axios.put(`${API_URL}/admin/orders/${orderId}`, payload, withAuth);

const deleteAdminOrder = (orderId) =>
  axios.delete(`${API_URL}/admin/orders/${orderId}`, withAuth);

const finalizeAdminOrder = (orderId) =>
  axios.post(`${API_URL}/admin/orders/${orderId}/finalize-payment`, {}, withAuth);

const fetchAdminStats = () => axios.get(`${API_URL}/admin/stats`, withAuth);

const sendGroupEmail = ({ messages }) =>
  axios.post(`${API_URL}/admin/email`, { messages }, withAuth);

export {
  login,
  checkSession,
  fetchAdminMeta,
  fetchOrdersPage,
  updatePickupStock,
  addPickupDate,
  updatePickupDate,
  deletePickupDate,
  updateOrdersStatus,
  createAdminOrder,
  updateAdminOrder,
  deleteAdminOrder,
  fetchAdminStats,
  finalizeAdminOrder,
  sendGroupEmail
};
