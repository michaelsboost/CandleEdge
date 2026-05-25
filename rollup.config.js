const terser = require("@rollup/plugin-terser");

export default {
  input: 'src/script.js', // entry point to your Javascript
  output: {
    file: 'dist/script.js',
    format: 'iife', // Immediately Invoked Function Expression, suitable for <script> tags
    name: 'candleedge'
  },
  plugins: [
    
    
    terser() // minifies the JavaScript
  ]
};