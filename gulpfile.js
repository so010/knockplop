var gulp = require('gulp'),
  connect = require('gulp-connect'),
  sass = require('gulp-sass'),
  nodemon = require('gulp-nodemon'),
  wiredep = require('wiredep').stream,
  concat = require('gulp-concat');

gulp.task('connect',function(){
  connect.server({
    livereload: true,
    host: '158.38.212.160',
    port: 8005,
    https: true
  });
});

gulp.task('reload',function(){
  gulp.src('./dist/**/*.*')
  .pipe(connect.reload());
});

gulp.task('js-process', function(){
  gulp.src('./app/js/*.js')
  .pipe(concat('app.js'))
  .pipe(gulp.dest('dist/scripts'));
});

gulp.task('html-process', function(){
  gulp.src('./app/**/*.html')
  .pipe(gulp.dest('./dist'));
});

gulp.task('css-process', function(){
  gulp.src('./app/css/*.css')
  .pipe(concat('all.css'))
  .pipe(gulp.dest('./dist/css'));
});

gulp.task('sass',function(){
  return gulp.src('./app/scss/*.scss')
  .pipe(sass())
  .pipe(gulp.dest('app/css'));
});

gulp.task('serve', function () {
    nodemon({
        script  : 'server.js',
        watch   : 'server.js'
        //...add nodeArgs: ['--debug=5858'] to debug
        //..or nodeArgs: ['--debug-brk=5858'] to debug at server start
    }).on('start', function () {
        setTimeout(function () {
            gulp.src('./dist/**/*.*')
              .pipe(connect.reload());
            console.log('reload browsers!');
        }, 100); // wait for the server to finish loading before restarting the browsers
    });
});

gulp.task('bower-dependencies', function () {
    gulp.src('./index.html')
    .pipe(wiredep({
  directory: './bower_components',
  bowerJson: require('./bower.json'),
    }))
    .pipe(gulp.dest('./dist'));
});


gulp.task('watch',function(){
  gulp.watch(['./app/scss/*.scss'], ['sass']);
  gulp.watch(['./app/js/*.js'],['js-process']);
  gulp.watch(['./dist/**/*.*'],['reload']);
  gulp.watch(['./app/**/*.html'],['html-process']);
  gulp.watch(['./app/css/*.css'],['css-process']);
});


gulp.task('default',['connect','watch','sass','js-process','serve','bower-dependencies','html-process']);
