export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,vue}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a1022',
        mist: '#eef3fb',
        haze: '#f8fbff',
        accent: '#2563eb'
      },
      boxShadow: {
        soft: '0 12px 24px rgba(8, 19, 48, 0.12)'
      }
    }
  },
  plugins: []
};
